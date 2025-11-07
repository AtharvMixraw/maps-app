#pragma once
#include <opencv2/opencv.hpp>

struct VisionPitchOut {
    double theta_vis_rad;
    double confidence; // 0..1
};

class VisionPitch {
public:
    VisionPitch() {}

    // TODO: implement FOE/vanishing/homography. Placeholder returns no update.
    VisionPitchOut estimate(const cv::Mat& undistorted_bgr) {
        return {0.0, 0.0}; // confidence 0 -> ignored by fuser
    }
};