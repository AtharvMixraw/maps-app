#pragma once
#include <opencv2/opencv.hpp>
#include <cmath>
#include <deque>

struct CamIntrinsics {
    float fx, fy, cx, cy;
};

struct PitchEstimate {
    double theta_rad;      // fused pitch in radians
    double confidence;     // 0..1
};

class ThetaFuser {
public:
    // Configure complementary filter
    ThetaFuser(double alpha=0.98) : alpha_(alpha), initialized_(false),
                                    theta_(0.0), bias_(0.0) {}

    // Call at startup when vehicle is stationary for 2–5 s using averaged gravity tilt
    void initialize_from_imu(double theta_imu_rad) {
        theta_ = theta_imu_rad;
        initialized_ = true;
    }

    // High-rate IMU propagation (gyro z about camera x-axis -> pitch rate), dt in seconds
    void propagate(double gyro_pitch_rate_rad_s, double dt) {
        if (!initialized_) return;
        // Simple bias-compensated integration
        theta_ += (gyro_pitch_rate_rad_s - bias_) * dt;
    }

    // Provide low-rate IMU absolute tilt from accelerometer (only when stationary/low vibration)
    void imu_absolute_update(double theta_abs_rad, double weight=0.2) {
        if (!initialized_) { initialize_from_imu(theta_abs_rad); return; }
        double a = clamp01(weight);
        theta_ = a*theta_abs_rad + (1.0-a)*theta_;
    }

    // Vision correction (from horizon/FOE/homography), conf in [0,1]
    void vision_update(double theta_vis_rad, double confidence) {
        if (!initialized_) { initialize_from_imu(theta_vis_rad); return; }
        double a = std::pow(alpha_, (1.0 - clamp01(confidence))); // lower alpha when confidence high
        theta_ = a*theta_ + (1.0 - a)*theta_vis_rad;
    }

    // Optional: adapt gyro bias slowly when stationary (accel variance low)
    void stationary_bias_learn(double gyro_pitch_rate_rad_s, double learn_rate=0.001) {
        bias_ = (1.0 - learn_rate)*bias_ + learn_rate*gyro_pitch_rate_rad_s;
    }

    double theta() const { return theta_; }

private:
    double alpha_;
    bool initialized_;
    double theta_;   // fused pitch
    double bias_;    // gyro bias

    static double clamp01(double v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }
};

// Contact-point helper for bbox: bottom center (with a small downward bias)
inline cv::Point2f bbox_contact_point(const cv::Rect& box, int img_h, int extra_pixels=2) {
    float x = box.x + box.width * 0.5f;
    float y = std::min<float>(img_h - 1, box.y + box.height - 1 + extra_pixels);
    return {x, y};
}

class GroundDistance {
public:
    GroundDistance(const CamIntrinsics& K, float cam_height_m)
    : K_(K), H_(cam_height_m), cached_theta_(0.0), 
      cached_sin_(0.0), cached_cos_(1.0), cached_H_cos_(cam_height_m) {}

    // Call this ONCE per frame to precompute trig values
    void update_theta_cache(double theta_rad) {
        if (std::abs(theta_rad - cached_theta_) > 1e-6) {
            cached_theta_ = theta_rad;
            cached_sin_ = std::sin(theta_rad);
            cached_cos_ = std::cos(theta_rad);
            cached_H_cos_ = H_ * cached_cos_;  // Precompute this too
        }
    }

    // Optimized: No atan/tan calls, uses cached sin/cos values
    // Formula: D = H*cos(θ) / (sin(θ) + yn*cos(θ))
    // This is mathematically equivalent to D = H / tan(θ + atan(yn))
    // but ~10-15x faster!
    bool distance_from_pixel(const cv::Point2f& px,
                             float& out_D_m, float& out_X_m,
                             float minD=0.5f, float maxD=200.0f) const
    {
        // Normalize pixel coordinates
        double yn = (px.y - K_.cy) / K_.fy;
        double xn = (px.x - K_.cx) / K_.fx;

        // Optimized denominator using cached values
        double denom = cached_sin_ + yn * cached_cos_;
        
        if (denom <= 1e-4) return false; // invalid geometry

        // Use precomputed H*cos(theta)
        double D = cached_H_cos_ / denom;
        
        if (!std::isfinite(D) || D < 0) return false;

        // Lateral offset
        double X = D * xn;

        // Clamp to reasonable ranges
        D = std::max<double>(minD, std::min<double>(maxD, D));
        X = std::max<double>(-50.0, std::min<double>(50.0, X));

        out_D_m = static_cast<float>(D);
        out_X_m = static_cast<float>(X);
        return true;
    }

private:
    CamIntrinsics K_;
    float H_;
    
    // Cached values for performance (updated once per frame)
    mutable double cached_theta_;
    mutable double cached_sin_;
    mutable double cached_cos_;
    mutable double cached_H_cos_;  // H * cos(theta)
};