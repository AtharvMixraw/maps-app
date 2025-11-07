/*
 * @Author: xuarehere
 * @Date: 2022-09-18 04:14:53
 * @LastEditTime: 2022-10-23 13:02:50
 * @LastEditors: xuarehere
 * @Description: 
 * @FilePath: /yolov7_deepsort_tensorrt/src/yolo.cpp
 * 
 */

#include "yolo.h"
#include "common.h" 
#include <chrono>

YOLO::YOLO(const YAML::Node &config) {
    std::cout << "YOLO Constructor: Starting..." << std::endl;
    
    onnx_file = config["onnx_file"].as<std::string>();
    engine_file = config["engine_file"].as<std::string>();
    
    std::cout << "YOLO Constructor: Engine file = " << engine_file << std::endl;
    
    // Use CLASS_NAMES from common.h instead of reading file
    if (config["labels_file"]) {
        std::string labels_file = config["labels_file"].as<std::string>();
        if (!labels_file.empty()) {
            class_labels = readClassLabel(labels_file);
        } else {
            for (size_t i = 0; i < CLASS_NAMES.size(); ++i) {
                class_labels[i] = CLASS_NAMES[i];
            }
        }
    } else {
        for (size_t i = 0; i < CLASS_NAMES.size(); ++i) {
            class_labels[i] = CLASS_NAMES[i];
        }
    }
    
    std::cout << "YOLO Constructor: Loaded " << class_labels.size() << " class labels" << std::endl;
    
    BATCH_SIZE = config["BATCH_SIZE"].as<int>();
    INPUT_CHANNEL = config["INPUT_CHANNEL"].as<int>();
    IMAGE_WIDTH = config["IMAGE_WIDTH"].as<int>();
    IMAGE_HEIGHT = config["IMAGE_HEIGHT"].as<int>();
    obj_threshold = config["obj_threshold"].as<float>();
    nms_threshold = config["nms_threshold"].as<float>();
    agnostic = config["agnostic"].as<bool>();
    strides = config["strides"].as<std::vector<int>>();
    
    std::cout << "YOLO Constructor: Config loaded" << std::endl;
    std::cout << "  BATCH_SIZE=" << BATCH_SIZE << std::endl;
    std::cout << "  IMAGE_WIDTH=" << IMAGE_WIDTH << " IMAGE_HEIGHT=" << IMAGE_HEIGHT << std::endl;
    
    // Handle anchors
    if (config["anchors"]) {
        anchors = config["anchors"].as<std::vector<std::vector<int>>>();
    }
    
    // add for yolov7
    if (config["num_anchors"]) {
        num_anchors = config["num_anchors"].as<std::vector<int>>();
    } else {
        num_anchors = {1, 1, 1};
    }
    
    CATEGORY = class_labels.size();
    
    std::cout << "YOLO Constructor: CATEGORY=" << CATEGORY << std::endl;
    
    grids = {
            {3, int(IMAGE_WIDTH / strides[0]), int(IMAGE_HEIGHT / strides[0])},
            {3, int(IMAGE_WIDTH / strides[1]), int(IMAGE_HEIGHT / strides[1])},
            {3, int(IMAGE_WIDTH / strides[2]), int(IMAGE_HEIGHT / strides[2])},
    };

    // Calculate num_rows
    num_rows = 0;
    int index = 0;
    for (const int &stride : strides)
    {
        int num_anchor = num_anchors[index] !=0 ? num_anchors[index] : 1;
        num_rows += int(IMAGE_HEIGHT / stride) * int(IMAGE_WIDTH / stride) * num_anchor;
        index+=1;
    }
    
    std::cout << "YOLO Constructor: num_rows=" << num_rows << std::endl;

    // Use COLORS from common.h
    class_colors.resize(CATEGORY);
    for (int i = 0; i < CATEGORY; i++) {
        if (i < (int)COLORS.size()) {
            class_colors[i] = cv::Scalar(COLORS[i][2], COLORS[i][1], COLORS[i][0]);
        } else {
            class_colors[i] = cv::Scalar(rand() % 255, rand() % 255, rand() % 255);
        }
    }
    
    std::cout << "YOLO Constructor: About to call LoadEngine()..." << std::endl;
    
    // This is where it should call Model::LoadEngine()
    LoadEngine();
    
    std::cout << "YOLO Constructor: LoadEngine() completed!" << std::endl;
}

YOLO::~YOLO() = default;

std::vector<std::vector<DetectRes>> YOLO::InferenceImages(std::vector<cv::Mat> &vec_img) {
    auto t_start_pre = std::chrono::high_resolution_clock::now();
    std::vector<float> image_data = prepareImage(vec_img);
    auto t_end_pre = std::chrono::high_resolution_clock::now();
    float total_pre = std::chrono::duration<float, std::milli>(t_end_pre - t_start_pre).count();
    std::cout << "YOLO prepare image take: " << total_pre << " ms." << std::endl;
    auto t_start = std::chrono::high_resolution_clock::now();
    auto *output = ModelInference(image_data);
    auto t_end = std::chrono::high_resolution_clock::now();
    float total_inf = std::chrono::duration<float, std::milli>(t_end - t_start).count();
    std::cout << "YOLO inference take: " << total_inf << " ms." << std::endl;
    auto r_start = std::chrono::high_resolution_clock::now();
    auto boxes = postProcess(vec_img, output);
    auto r_end = std::chrono::high_resolution_clock::now();
    float total_res = std::chrono::duration<float, std::milli>(r_end - r_start).count();
    std::cout << "YOLO postprocess take: " << total_res << " ms." << std::endl;
    delete output;
    return boxes;
}

std::vector<float> YOLO::prepareImage(std::vector<cv::Mat> &vec_img) {
    std::vector<float> result(BATCH_SIZE * IMAGE_WIDTH * IMAGE_HEIGHT * INPUT_CHANNEL);
    float *data = result.data();
    int index = 0;
    for (const cv::Mat &src_img : vec_img)
    {
        if (!src_img.data)
            continue;
        float ratio = float(IMAGE_WIDTH) / float(src_img.cols) < float(IMAGE_HEIGHT) / float(src_img.rows) ? float(IMAGE_WIDTH) / float(src_img.cols) : float(IMAGE_HEIGHT) / float(src_img.rows);
        cv::Mat flt_img = cv::Mat::zeros(cv::Size(IMAGE_WIDTH, IMAGE_HEIGHT), CV_8UC3);
        cv::Mat rsz_img;
        cv::resize(src_img, rsz_img, cv::Size(), ratio, ratio);
        rsz_img.copyTo(flt_img(cv::Rect(0, 0, rsz_img.cols, rsz_img.rows)));
        flt_img.convertTo(flt_img, CV_32FC3, 1.0 / 255);

        //HWC TO CHW
        int channelLength = IMAGE_WIDTH * IMAGE_HEIGHT;
        std::vector<cv::Mat> split_img = {
                cv::Mat(IMAGE_WIDTH, IMAGE_HEIGHT, CV_32FC1, data + channelLength * (index + 2)),
                cv::Mat(IMAGE_WIDTH, IMAGE_HEIGHT, CV_32FC1, data + channelLength * (index + 1)),
                cv::Mat(IMAGE_WIDTH, IMAGE_HEIGHT, CV_32FC1, data + channelLength * index)
        };
        index += 3;
        cv::split(flt_img, split_img);
    }
    return result;
}

float *YOLO::ModelInference(std::vector<float> image_data) {
    auto *out = new float[outSize * BATCH_SIZE];
    if (image_data.empty()) {
        std::cout << "prepare images ERROR!" << std::endl;
        return out;
    }
    
    // Set tensor addresses (TensorRT 10 API)
    const char* inputName = engine->getIOTensorName(0);
    const char* outputName = engine->getIOTensorName(1);
    
    context->setTensorAddress(inputName, buffers[0]);
    context->setTensorAddress(outputName, buffers[1]);
    
    // DMA the input to the GPU
    cudaMemcpyAsync(buffers[0], image_data.data(), bufferSize[0], cudaMemcpyHostToDevice, stream);

    // Do inference (TensorRT 10 uses enqueueV3)
    bool success = context->enqueueV3(stream);
    if (!success) {
        std::cout << "ERROR: Inference failed!" << std::endl;
    }
    
    // DMA output back
    cudaMemcpyAsync(out, buffers[1], bufferSize[1], cudaMemcpyDeviceToHost, stream);
    cudaStreamSynchronize(stream);
    
    return out;     
}


std::vector<std::vector<DetectRes>> YOLO::postProcess(const std::vector<cv::Mat> &vec_Mat, float *output) {
    std::vector<std::vector<DetectRes>> vec_result;
    int index = 0;
    
    for (const cv::Mat &src_img : vec_Mat) {
        std::vector<DetectRes> result;
        float ratio = float(src_img.cols) / float(IMAGE_WIDTH) > float(src_img.rows) / float(IMAGE_HEIGHT) 
                      ? float(src_img.cols) / float(IMAGE_WIDTH) 
                      : float(src_img.rows) / float(IMAGE_HEIGHT);
        
        float *out = output + index * outSize;
        
        // YOLOv11 format: [num_classes + 4, num_boxes]
        // For 1 class: [5, 8400] -> [x, y, w, h, score]
        int num_boxes = 8400;  // Standard for 640x640
        int num_elements = CATEGORY + 4;  // 4 (bbox) + 1 (class)
        
        std::cout << "PostProcess: Processing " << num_boxes << " boxes" << std::endl;
        
        for (int i = 0; i < num_boxes; i++) {
            // YOLOv11: data is channel-first [C, N]
            // Channel 0-3: bbox (x, y, w, h)
            // Channel 4+: class scores
            
            float x = out[0 * num_boxes + i];  // x channel
            float y = out[1 * num_boxes + i];  // y channel
            float w = out[2 * num_boxes + i];  // w channel
            float h = out[3 * num_boxes + i];  // h channel
            
            // For single class, score is at channel 4
            float score = out[4 * num_boxes + i];
            
            // Apply sigmoid to score if needed (usually already applied in ONNX)
            // score = 1.0f / (1.0f + exp(-score));
            
            if (score < obj_threshold)
                continue;
            
            DetectRes box;
            box.prob = score;
            box.classes = 0;  // Single class: pothole
            box.x = x * ratio;
            box.y = y * ratio;
            box.w = w * ratio;
            box.h = h * ratio;
            
            result.push_back(box);
        }
        
        std::cout << "PostProcess: Found " << result.size() << " detections before NMS" << std::endl;
        
        NmsDetect(result);
        
        std::cout << "PostProcess: " << result.size() << " detections after NMS" << std::endl;
        
        vec_result.push_back(result);
        index++;
    }
    return vec_result;
}


void YOLO::NmsDetect(std::vector<DetectRes> &detections) {
    sort(detections.begin(), detections.end(), [=](const DetectRes &left, const DetectRes &right) {
        return left.prob > right.prob;
    });

    for (int i = 0; i < (int)detections.size(); i++)
        for (int j = i + 1; j < (int)detections.size(); j++)
        {
            if (detections[i].classes == detections[j].classes or agnostic)
            {
                float iou = IOUCalculate(detections[i], detections[j]);
                if (iou > nms_threshold)
                    detections[j].prob = 0;
            }
        }

    detections.erase(std::remove_if(detections.begin(), detections.end(), [](const DetectRes &det)
    { return det.prob == 0; }), detections.end());
}

float YOLO::IOUCalculate(const DetectRes &det_a, const DetectRes &det_b) {
    cv::Point2f center_a(det_a.x, det_a.y);
    cv::Point2f center_b(det_b.x, det_b.y);
    cv::Point2f left_up(std::min(det_a.x - det_a.w / 2, det_b.x - det_b.w / 2),
                        std::min(det_a.y - det_a.h / 2, det_b.y - det_b.h / 2));
    cv::Point2f right_down(std::max(det_a.x + det_a.w / 2, det_b.x + det_b.w / 2),
                           std::max(det_a.y + det_a.h / 2, det_b.y + det_b.h / 2));
    float distance_d = (center_a - center_b).x * (center_a - center_b).x + (center_a - center_b).y * (center_a - center_b).y;
    float distance_c = (left_up - right_down).x * (left_up - right_down).x + (left_up - right_down).y * (left_up - right_down).y;
    float inter_l = det_a.x - det_a.w / 2 > det_b.x - det_b.w / 2 ? det_a.x - det_a.w / 2 : det_b.x - det_b.w / 2;
    float inter_t = det_a.y - det_a.h / 2 > det_b.y - det_b.h / 2 ? det_a.y - det_a.h / 2 : det_b.y - det_b.h / 2;
    float inter_r = det_a.x + det_a.w / 2 < det_b.x + det_b.w / 2 ? det_a.x + det_a.w / 2 : det_b.x + det_b.w / 2;
    float inter_b = det_a.y + det_a.h / 2 < det_b.y + det_b.h / 2 ? det_a.y + det_a.h / 2 : det_b.y + det_b.h / 2;
    if (inter_b < inter_t || inter_r < inter_l)
        return 0;
    float inter_area = (inter_b - inter_t) * (inter_r - inter_l);
    float union_area = det_a.w * det_a.h + det_b.w * det_b.h - inter_area;
    if (union_area == 0)
        return 0;
    else
        return inter_area / union_area - distance_d / distance_c;
}

void YOLO::DrawResults(const std::vector<std::vector<DetectRes>> &detections, std::vector<cv::Mat> &vec_img) {
    for (int i = 0; i < (int)vec_img.size(); i++) {
        auto org_img = vec_img[i];
        if (!org_img.data)
            continue;
        auto rects = detections[i];
        cv::cvtColor(org_img, org_img, cv::COLOR_BGR2RGB);
        for(const auto &rect : rects) {
            char t[256];
            sprintf(t, "%.2f", rect.prob);
            std::string name = class_labels[rect.classes] + "-" + t;
            cv::putText(org_img, name, cv::Point(rect.x - rect.w / 2, rect.y - rect.h / 2 - 5),
                    cv::FONT_HERSHEY_COMPLEX, 0.7, class_colors[rect.classes], 2);
            cv::Rect rst(rect.x - rect.w / 2, rect.y - rect.h / 2, rect.w, rect.h);
            cv::rectangle(org_img, rst, class_colors[rect.classes], 2, cv::LINE_8, 0);
        }
    }
}
