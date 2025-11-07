#include <iostream>
#include <opencv2/opencv.hpp>
#include <cmath>
#include <deque>
#include <chrono>
#include <iomanip>
#include <thread>
#include "yolo.h"
#include "sort.h"
#include "logging.h"

using namespace cv;
using namespace std;
using namespace sort;

static Logger logger;
#include <curl/curl.h>  // apt install libcurl4-openssl-dev

/**********************************************
* Real-time Distance Streamer
**********************************************/
class RealtimeDistanceStreamer {
public:
    RealtimeDistanceStreamer(const string& endpoint_url = "http://localhost:5000/webhook")
        : endpoint_(endpoint_url) {
        curl_global_init(CURL_GLOBAL_DEFAULT);
    }

    ~RealtimeDistanceStreamer() {
        curl_global_cleanup();
    }

    void send_detection(int trackerId, float distance_m, float lateral_m, int frame_num, double theta_deg) {
        // Construct JSON payload
        char json[512];
        snprintf(json, sizeof(json),
            "{"
            "\"track_id\": %d, "
            "\"distance_m\": %.2f, "
            "\"lateral_m\": %.2f, "
            "\"frame\": %d, "
            "\"theta_deg\": %.2f, "
            "\"timestamp_ms\": %lld"
            "}",
            trackerId, distance_m, lateral_m, frame_num, theta_deg,
            chrono::duration_cast<chrono::milliseconds>(
                chrono::high_resolution_clock::now().time_since_epoch()).count()
        );

        // Send via POST (non-blocking in separate thread)
        std::thread(&RealtimeDistanceStreamer::_post_json, this, json).detach();
    }

    void send_batch(const vector<pair<int, pair<float, float>>>& detections, int frame_num, double theta_deg, 
                    const vector<pair<int, pair<float, float>>>& sizes = {}) {
        char json[4096];
        int pos = snprintf(json, sizeof(json), "{"
            "\"frame\": %d, "
            "\"theta_deg\": %.2f, "
            "\"detections\": [", frame_num, theta_deg);

        for (size_t i = 0; i < detections.size(); ++i) {
            int id = detections[i].first;
            float D = detections[i].second.first;
            float X = detections[i].second.second;
            float size = 0.0f;
            if (i < sizes.size()) {
                size = sizes[i].second.first; // size in square meters
            }
            pos += snprintf(json + pos, sizeof(json) - pos,
                "{\"id\": %d, \"d\": %.2f, \"x\": %.2f, \"size\": %.4f}%s",
                id, D, X, size, i < detections.size()-1 ? ", " : "");
        }
        pos += snprintf(json + pos, sizeof(json) - pos, "], "
            "\"timestamp_ms\": %lld}",
            chrono::duration_cast<chrono::milliseconds>(
                chrono::high_resolution_clock::now().time_since_epoch()).count());

        std::thread(&RealtimeDistanceStreamer::_post_json, this, json).detach();
    }

private:
    string endpoint_;

    void _post_json(const string& json_str) {
        CURL* curl = curl_easy_init();
        if (!curl) return;

        struct curl_slist* headers = nullptr;
        headers = curl_slist_append(headers, "Content-Type: application/json");

        curl_easy_setopt(curl, CURLOPT_URL, endpoint_.c_str());
        curl_easy_setopt(curl, CURLOPT_HTTPHEADER, headers);
        curl_easy_setopt(curl, CURLOPT_POSTFIELDS, json_str.c_str());
        curl_easy_setopt(curl, CURLOPT_TIMEOUT, 1L);  // 1s timeout so it doesn't block

        CURLcode res = curl_easy_perform(curl);
        if (res != CURLE_OK) {
            // Silent fail - don't spam console
        }

        curl_slist_free_all(headers);
        curl_easy_cleanup(curl);
    }
};

/**********************************************
* Utilities
**********************************************/
vector<Scalar> generateColors(int numColors) {
    RNG rng(numColors);
    vector<Scalar> colors;
    for (int i = 0; i < numColors; ++i) {
        colors.push_back(Scalar(rng.uniform(0, 255), rng.uniform(0, 255), rng.uniform(0, 255)));
    }
    return colors;
}

Mat convertDetectionsToSort(const vector<DetectRes>& detections) {
    if (detections.empty()) {
        return Mat(0, 5, CV_32F);
    }
    Mat sortInput(detections.size(), 5, CV_32F);
    for (size_t i = 0; i < detections.size(); ++i) {
        const auto& det = detections[i];
        float x1 = det.x - det.w / 2.0f;
        float y1 = det.y - det.h / 2.0f;
        float x2 = det.x + det.w / 2.0f;
        float y2 = det.y + det.h / 2.0f;
        sortInput.at<float>(i, 0) = x1;
        sortInput.at<float>(i, 1) = y1;
        sortInput.at<float>(i, 2) = x2;
        sortInput.at<float>(i, 3) = y2;
        sortInput.at<float>(i, 4) = det.prob;
    }
    return sortInput;
}

/**********************************************
* Distance + Pitch Fuser
**********************************************/
struct CamIntrinsics {
    float fx, fy, cx, cy;
};

class ThetaFuser {
public:
    explicit ThetaFuser(double alpha=0.985)
        : alpha_(alpha), initialized_(false), theta_(0.0), bias_(0.0) {}

    void initialize_from_imu(double theta_imu_rad) {
        theta_ = theta_imu_rad;
        initialized_ = true;
    }
    void propagate(double gyro_pitch_rate_rad_s, double dt) {
        if (!initialized_) return;
        theta_ += (gyro_pitch_rate_rad_s - bias_) * dt;
    }
    void imu_absolute_update(double theta_abs_rad, double weight=0.2) {
        if (!initialized_) { initialize_from_imu(theta_abs_rad); return; }
        double a = clamp01(weight);
        theta_ = a*theta_abs_rad + (1.0-a)*theta_;
    }
    void vision_update(double theta_vis_rad, double confidence) {
        if (!initialized_) { initialize_from_imu(theta_vis_rad); return; }
        double conf = clamp01(confidence);
        double a = std::pow(alpha_, (1.0 - conf));
        theta_ = a*theta_ + (1.0 - a)*theta_vis_rad;
    }
    void stationary_bias_learn(double gyro_pitch_rate_rad_s, double learn_rate=0.002) {
        bias_ = (1.0 - learn_rate)*bias_ + learn_rate*gyro_pitch_rate_rad_s;
    }
    double theta() const { return theta_; }

private:
    double alpha_;
    bool initialized_;
    double theta_;
    double bias_;
    static double clamp01(double v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
};

inline Point2f bbox_contact_point(const Rect& box, int img_h, int extra_pixels=2) {
    float x = box.x + box.width * 0.5f;
    float y = std::min<float>(img_h - 1, box.y + box.height - 1 + extra_pixels);
    return {x, y};
}

class GroundDistance {
public:
    GroundDistance(const CamIntrinsics& K, float cam_height_m)
    : K_(K), H_(cam_height_m), cached_theta_(0.0), 
      cached_sin_(0.0), cached_cos_(1.0), cached_H_cos_(cam_height_m) {}

    void update_theta_cache(double theta_rad) {
        if (std::abs(theta_rad - cached_theta_) > 1e-6) {
            cached_theta_ = theta_rad;
            cached_sin_ = std::sin(theta_rad);
            cached_cos_ = std::cos(theta_rad);
            cached_H_cos_ = H_ * cached_cos_;
        }
    }

    bool distance_from_pixel(const Point2f& px,
                             float& out_D_m, float& out_X_m,
                             float minD=0.5f, float maxD=200.0f) const
    {
        double yn = (px.y - K_.cy) / K_.fy;
        double xn = (px.x - K_.cx) / K_.fx;
        
        double denom = cached_sin_ + yn * cached_cos_;
        
        if (denom <= 1e-4) return false;
        
        double D = cached_H_cos_ / denom;
        
        if (!std::isfinite(D) || D < 0) return false;
        
        double X = D * xn;
        
        D = std::max<double>(minD, std::min<double>(maxD, D));
        X = std::max<double>(-50.0, std::min<double>(50.0, X));
        
        out_D_m = static_cast<float>(D);
        out_X_m = static_cast<float>(X);
        return true;
    }

private:
    CamIntrinsics K_;
    float H_;
    mutable double cached_theta_;
    mutable double cached_sin_;
    mutable double cached_cos_;
    mutable double cached_H_cos_;
};

/**********************************************
* Drawing with Distance - OPTIMIZED
**********************************************/
void drawTrackedWithDistance(Mat& img,
                             const Mat& trackedBboxes,
                             const vector<Scalar>& colors,
                             GroundDistance& gdist)
{
    std::ostringstream oss;
    
    for (int i = 0; i < trackedBboxes.rows; ++i) {
        float x1 = trackedBboxes.at<float>(i, 0);
        float y1 = trackedBboxes.at<float>(i, 1);
        float x2 = trackedBboxes.at<float>(i, 2);
        float y2 = trackedBboxes.at<float>(i, 3);
        int trackerId = static_cast<int>(trackedBboxes.at<float>(i, 7));

        int ix1 = cvRound(x1);
        int iy1 = cvRound(y1);
        int ix2 = cvRound(x2);
        int iy2 = cvRound(y2);
        
        Rect box(ix1, iy1, ix2 - ix1, iy2 - iy1);
        Scalar color = colors[trackerId % colors.size()];
        
        rectangle(img, box, color, 2);

        int contact_x = box.x + box.width / 2;
        int contact_y = std::min(img.rows - 1, box.y + box.height + 1);
        circle(img, Point(contact_x, contact_y), 3, Scalar(0, 255, 0), -1);

        Point2f contact_f(contact_x, contact_y);
        float D = 0.f, X = 0.f;
        bool ok = gdist.distance_from_pixel(contact_f, D, X);

        oss.str("");
        oss.clear();
        oss << "ID:" << trackerId;
        if (ok) {
            oss << "|" << static_cast<int>(D + 0.5f) << "m";
        }
        string label = oss.str();

        int baseline = 0;
        Size textSize = getTextSize(label, FONT_HERSHEY_SIMPLEX, 0.5, 1, &baseline);
        
        int text_y = box.y - 5;
        if (text_y < textSize.height) text_y = box.y + textSize.height + 5;
        
        rectangle(img,
                  Point(box.x, text_y - textSize.height - 3),
                  Point(box.x + textSize.width + 4, text_y + 2),
                  color, FILLED);
        putText(img, label, Point(box.x + 2, text_y),
                FONT_HERSHEY_SIMPLEX, 0.5, Scalar(255, 255, 255), 1);
    }
}

/**********************************************
* UI / CLI
**********************************************/
void printUsage(const char* programName) {
    cout << "\n==================================================" << endl;
    cout << "YOLO + SORT Object Tracking with TensorRT + Distance" << endl;
    cout << "==================================================" << endl;
    cout << "\nUsage:" << endl;
    cout << "\n1. Build TensorRT Engine:" << endl;
    cout << "  " << programName << " --build-engine -o <onnx_path> -e <engine_output_path>" << endl;
    cout << "\n2. Run Inference:" << endl;
    cout << "  " << programName << " --run -v <video_path> -e <engine_path>" << endl;
    cout << "\nOptions:" << endl;
    cout << "  --build-engine         Build TensorRT engine from ONNX" << endl;
    cout << "  --run                  Run inference on video" << endl;
    cout << "  -v, --video <path>     Video file path (required for --run)" << endl;
    cout << "  -o, --onnx <path>      ONNX model path (required for --build-engine)" << endl;
    cout << "  -e, --engine <path>    TensorRT engine path (required)" << endl;
    cout << "  --fx <val>             fx (pixels)" << endl;
    cout << "  --fy <val>             fy (pixels)" << endl;
    cout << "  --cx <val>             cx (pixels)" << endl;
    cout << "  --cy <val>             cy (pixels)" << endl;
    cout << "  --h_m <val>            camera height H in meters (default 1.50)" << endl;
    cout << "  --theta_init_deg <v>   initial pitch in degrees (IMU init, default 15)" << endl;
    cout << "\nControls:" << endl;
    cout << "  SPACEBAR               Pause/Resume" << endl;
    cout << "  ESC                    Exit" << endl;
    cout << "==================================================" << endl;
}

bool buildEngine(const string& onnxPath, const string& enginePath) {
    cout << "\n==================================================" << endl;
    cout << "Building TensorRT Engine" << endl;
    cout << "==================================================" << endl;
    cout << "ONNX file: " << onnxPath << endl;
    cout << "Output engine: " << enginePath << endl;
    cout << "==================================================" << endl;

    string cmd = "/usr/src/tensorrt/bin/trtexec "
                 "--onnx=" + onnxPath + " "
                 "--saveEngine=" + enginePath + " "
                 "--fp16 "
                 "--useCudaGraph "
                 "--useSpinWait "
                 "--avgRuns=100 "
                 "--verbose";
    cout << "\nExecuting: " << cmd << endl;
    cout << "\nBuilding engine (this may take a few minutes)...\n" << endl;

    int result = system(cmd.c_str());
    if (result == 0) {
        cout << "\n==================================================" << endl;
        cout << "Engine built successfully!" << endl;
        cout << "Engine saved to: " << enginePath << endl;
        cout << "==================================================" << endl;
        return true;
    } else {
        cerr << "\n==================================================" << endl;
        cerr << "Failed to build engine!" << endl;
        cerr << "==================================================" << endl;
        return false;
    }
}
int main(int argc, char** argv) {
    string mode, videoPath, onnxPath, enginePath;

    CamIntrinsics K{600.f, 600.f, 640.f/2.f, 480.f/2.f};
    float H_m = 1.50f;
    double theta_init_deg = 15.0;

    for (int i = 1; i < argc; ++i) {
        string arg = argv[i];
        if (arg == "-h" || arg == "--help") { printUsage(argv[0]); return 0; }
        else if (arg == "--build-engine") { mode = "build"; }
        else if (arg == "--run") { mode = "run"; }
        else if (arg == "-v" || arg == "--video") {
            if (i + 1 < argc) videoPath = argv[++i]; else { cerr << "Error: --video needs path\n"; return -1; }
        }
        else if (arg == "-o" || arg == "--onnx") {
            if (i + 1 < argc) onnxPath = argv[++i]; else { cerr << "Error: --onnx needs path\n"; return -1; }
        }
        else if (arg == "-e" || arg == "--engine") {
            if (i + 1 < argc) enginePath = argv[++i]; else { cerr << "Error: --engine needs path\n"; return -1; }
        }
        else if (arg == "--fx" && i+1 < argc) { K.fx = stof(argv[++i]); }
        else if (arg == "--fy" && i+1 < argc) { K.fy = stof(argv[++i]); }
        else if (arg == "--cx" && i+1 < argc) { K.cx = stof(argv[++i]); }
        else if (arg == "--cy" && i+1 < argc) { K.cy = stof(argv[++i]); }
        else if (arg == "--h_m" && i+1 < argc) { H_m = stof(argv[++i]); }
        else if (arg == "--theta_init_deg" && i+1 < argc) { theta_init_deg = stod(argv[++i]); }
        else if (arg == "--server" && i+1 < argc) { /* custom server URL support */ }
        else { cerr << "Error: Unknown argument: " << arg << endl; printUsage(argv[0]); return -1; }
    }

    if (mode.empty()) {
        cerr << "Error: Must specify either --build-engine or --run" << endl;
        printUsage(argv[0]);
        return -1;
    }

    if (mode == "build") {
        if (onnxPath.empty() || enginePath.empty()) {
            cerr << "Error: --onnx and --engine required for --build-engine" << endl;
            printUsage(argv[0]); return -1;
        }
        bool success = buildEngine(onnxPath, enginePath);
        return success ? 0 : -1;
    }

    if (mode == "run") {
        if (videoPath.empty() || enginePath.empty()) {
            cerr << "Error: --video and --engine required for --run" << endl;
            printUsage(argv[0]); return -1;
        }

        cout << "\n==================================================" << endl;
        cout << "Running Inference + Distance + Real-time Stream" << endl;
        cout << "==================================================" << endl;
        cout << "Video: " << videoPath << endl;
        cout << "Engine: " << enginePath << endl;
        cout << "fx=" << K.fx << " fy=" << K.fy << " cx=" << K.cx << " cy=" << K.cy << endl;
        cout << "H=" << H_m << " m, theta_init=" << theta_init_deg << " deg" << endl;
        cout << "Streaming to: http://localhost:5000/pothole" << endl;
        cout << "Dashboard: http://localhost:5000 (after starting server)" << endl;
        cout << "==================================================" << endl;

        YAML::Node config;
        config["BATCH_SIZE"] = 1;
        config["INPUT_CHANNEL"] = 3;
        config["IMAGE_WIDTH"] = 640;
        config["IMAGE_HEIGHT"] = 640;
        config["INPUT_WIDTH"] = 640;
        config["INPUT_HEIGHT"] = 640;
        config["obj_threshold"] = 0.5;
        config["nms_threshold"] = 0.4;
        config["agnostic"] = false;
        config["CATEGORY_NUM"] = 1;
        config["onnx_file"] = "";
        config["engine_file"] = enginePath;
        config["labels_file"] = "";
        config["strides"] = std::vector<int>{8, 16, 32};
        std::vector<std::vector<int>> empty_anchors = {{}, {}, {}};
        config["anchors"] = empty_anchors;
        config["num_anchors"] = std::vector<int>{1, 1, 1};

        cout << "\nInitializing YOLO model..." << endl;
        YOLO detector(config);
        cout << "Model loaded successfully!" << endl;

        cout << "Opening video file..." << endl;
        VideoCapture cap(videoPath);
        cap.set(CAP_PROP_BUFFERSIZE, 1);
        if (!cap.isOpened()) { cerr << "Error: Cannot open video file: " << videoPath << endl; return -1; }

        int frameWidth  = static_cast<int>(cap.get(CAP_PROP_FRAME_WIDTH));
        int frameHeight = static_cast<int>(cap.get(CAP_PROP_FRAME_HEIGHT));
        double fps      = cap.get(CAP_PROP_FPS);
        int totalFrames = static_cast<int>(cap.get(CAP_PROP_FRAME_COUNT));

        cout << "\nVideo Properties:\n  Resolution: " << frameWidth << "x" << frameHeight
             << "\n  FPS: " << fps << "\n  Total Frames: " << totalFrames << endl;

        ThetaFuser thetaFuser(0.985);
        double theta0_rad = theta_init_deg * M_PI / 180.0;
        thetaFuser.initialize_from_imu(theta0_rad);
        GroundDistance gdist(K, H_m);

        auto lastTick = chrono::steady_clock::now();

        Sort::Ptr tracker = make_shared<Sort>(30, 3, 0.3f);
        vector<Scalar> colors = generateColors(100);

        // Initialize real-time streamer
        RealtimeDistanceStreamer streamer("http://localhost:5001/webhook");
        cout << "Real-time streamer initialized (endpoint: /webhook)" << endl;

        namedWindow("YOLO + SORT + Distance", WINDOW_NORMAL);
        resizeWindow("YOLO + SORT + Distance", 1280, 720);

        Mat frame;
        int frameCount = 0;
        // Removed paused flag - model runs continuously without pausing

        cout << "\n==================================================" << endl;
        cout << "Starting continuous tracking... (ESC=Exit)" << endl;
        cout << "Note: Model runs continuously, no pausing on detection" << endl;
        cout << "==================================================" << endl;

        auto startTime = chrono::high_resolution_clock::now();
        
        // Frame rate control: 30 FPS = 33.33ms per frame
        const double targetFps = 30.0;
        const double frameTimeMs = 1000.0 / targetFps; // ~33.33ms per frame
        auto lastFrameTime = chrono::high_resolution_clock::now();

        while (true) {
            // Continuous processing - no pause logic
            if (!cap.read(frame)) {
                    // End of video reached - loop back to start
                    cout << "\nEnd of video reached. Looping back to start..." << endl;
                    cap.set(cv::CAP_PROP_POS_FRAMES, 0); // Reset to first frame
                    frameCount = 0; // Reset frame counter
                    // Reset tracker for new loop
                    tracker = make_shared<Sort>(30, 3, 0.3f);
                    // Reinitialize theta fuser
                    thetaFuser.initialize_from_imu(theta0_rad);
                    cout << "Video looped - restarting detection..." << endl;
                    continue; // Continue to next iteration to read first frame
                }
                frameCount++;

                auto now = chrono::steady_clock::now();
                double dt = chrono::duration<double>(now - lastTick).count();
                lastTick = now;
                double gyro_pitch_rate_rad_s = 0.0;
                thetaFuser.propagate(gyro_pitch_rate_rad_s, dt);

                bool vehicle_stationary = false;
                bool accel_reliable = false;
                if (vehicle_stationary && accel_reliable) {
                    double theta_abs = theta0_rad;
                    thetaFuser.imu_absolute_update(theta_abs, 0.3);
                    thetaFuser.stationary_bias_learn(gyro_pitch_rate_rad_s, 0.002);
                }

                vector<Mat> frames = {frame};
                vector<vector<DetectRes>> batch_res = detector.InferenceImages(frames);
                vector<DetectRes> detections = batch_res[0];

                Mat sortDetections = convertDetectionsToSort(detections);
                Mat trackedBboxes = tracker->update(sortDetections);

                double theta = thetaFuser.theta();
                gdist.update_theta_cache(theta);

                drawTrackedWithDistance(frame, trackedBboxes, colors, gdist);

                // Collect detections for real-time streaming
                vector<pair<int, pair<float, float>>> frame_detections;
                vector<pair<int, pair<float, float>>> frame_sizes;
                bool pothole_detected = false;

                for (int i = 0; i < trackedBboxes.rows; ++i) {
                    float x1 = trackedBboxes.at<float>(i, 0);
                    float y1 = trackedBboxes.at<float>(i, 1);
                    float x2 = trackedBboxes.at<float>(i, 2);
                    float y2 = trackedBboxes.at<float>(i, 3);
                    int trackerId = static_cast<int>(trackedBboxes.at<float>(i, 7));

                    int ix1 = cvRound(x1), iy1 = cvRound(y1), ix2 = cvRound(x2), iy2 = cvRound(y2);
                    Rect box(ix1, iy1, ix2-ix1, iy2-iy1);

                    int contact_x = box.x + box.width/2;
                    int contact_y = std::min(frame.rows-1, box.y+box.height+1);
                    Point2f contact_f(contact_x, contact_y);

                    float D=0.f, X=0.f;
                    bool ok = gdist.distance_from_pixel(contact_f, D, X);

                    if (ok) {
                        frame_detections.push_back({trackerId, {D, X}});
                        pothole_detected = true;
                        
                        // Calculate pothole size (bounding box area in real-world coordinates)
                        // Convert pixel dimensions to real-world size
                        // Approximate: use distance to estimate pixel-to-meter conversion
                        float pixel_width = box.width;
                        float pixel_height = box.height;
                        // Rough conversion: assume camera FOV and use distance
                        // More accurate would require camera calibration, but this is an approximation
                        float pixel_to_meter = D / (frame.rows * 0.5f); // Approximate conversion
                        float size_m2 = (pixel_width * pixel_to_meter) * (pixel_height * pixel_to_meter);
                        frame_sizes.push_back({trackerId, {size_m2, 0.0f}});
                    }
                }

                // Stream detections to server (non-blocking, runs in separate thread)
                if (!frame_detections.empty()) {
                    streamer.send_batch(frame_detections, frameCount, theta*180.0/M_PI, frame_sizes);
                    
                    // Log detection but continue processing (no pause)
                    if (pothole_detected) {
                        cout << "\n[DETECTED] Pothole detected at frame " << frameCount << " - continuing..." << endl;
                    }
                }

                {
                    std::ostringstream hud;
                    hud << "Frame: " << frameCount << "/" << totalFrames
                        << " | Tracks: " << trackedBboxes.rows
                        << " | theta: " << fixed << setprecision(2) << (theta * 180.0 / M_PI) << " deg"
                        << " | Streaming: " << (frame_detections.empty() ? "0" : to_string(frame_detections.size())) << " potholes";
                    putText(frame, hud.str(), Point(10, 30),
                            FONT_HERSHEY_SIMPLEX, 0.7, Scalar(0, 255, 0), 2);
                }

                if (frameCount % 30 == 0) {
                    auto currentTime = chrono::high_resolution_clock::now();
                    auto duration = chrono::duration_cast<chrono::seconds>(currentTime - startTime);
                    double processingFps = (duration.count() > 0) ? frameCount / (double)duration.count() : 0;
                    cout << "Progress: " << frameCount << "/" << totalFrames
                         << " (" << (frameCount * 100 / max(1,totalFrames)) << "%) "
                         << "| FPS: " << fixed << setprecision(2) << processingFps << " (target: " << targetFps << ")" << endl;
                }
            imshow("YOLO + SORT + Distance", frame);
            
            // Frame rate control: maintain 30 FPS
            auto currentFrameTime = chrono::high_resolution_clock::now();
            auto elapsed = chrono::duration_cast<chrono::milliseconds>(currentFrameTime - lastFrameTime);
            double elapsedMs = elapsed.count();
            
            if (elapsedMs < frameTimeMs) {
                // Wait to maintain 30 FPS
                int waitTime = static_cast<int>(frameTimeMs - elapsedMs);
                int key = waitKey(waitTime);
                
                if (key == 27) { 
                    cout << "\nESC pressed. Exiting..." << endl;
                    break;
                }
            } else {
                // Frame took longer than target time, process immediately
                int key = waitKey(1);
                
                if (key == 27) { 
                    cout << "\nESC pressed. Exiting..." << endl;
                    break;
                }
            }
            
            lastFrameTime = chrono::high_resolution_clock::now();
            // Removed SPACEBAR pause/resume - model runs continuously
        }

        auto endTime = chrono::high_resolution_clock::now();
        auto totalDuration = chrono::duration_cast<chrono::seconds>(endTime - startTime);
        double avgFps = (totalDuration.count() > 0) ? frameCount / (double)totalDuration.count() : 0;

        cout << "\n==================================================" << endl;
        cout << "Tracking Complete!" << endl;
        cout << "  Frames Processed: " << frameCount << endl;
        cout << "  Total Time: " << totalDuration.count() << " seconds" << endl;
        cout << "  Average FPS: " << fixed << setprecision(2) << avgFps << endl;
        cout << "==================================================" << endl;

        cap.release();
        destroyAllWindows();
    }

    return 0;
}
