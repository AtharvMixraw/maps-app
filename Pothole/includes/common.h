#ifndef TRACKER_COMMON_H
#define TRACKER_COMMON_H

#include <cuda_runtime_api.h>
#include <numeric>
#include <fstream>
#include <dirent.h>
#include "NvOnnxParser.h"
#include "logging.h"
#include <map>
#include <vector>
#include <string>

// Memory size literals
constexpr long long int operator"" _GiB(long long unsigned int val) {
    return val * (1 << 30);
}
constexpr long long int operator"" _MiB(long long unsigned int val) {
    return val * (1 << 20);
}
constexpr long long int operator"" _KiB(long long unsigned int val) {
    return val * (1 << 10);
}

// Global loggers
static Logger gLogger{Logger::Severity::kINFO};
static LogStreamConsumer gLogVerbose{LOG_VERBOSE(gLogger)};
static LogStreamConsumer gLogInfo{LOG_INFO(gLogger)};
static LogStreamConsumer gLogWarning{LOG_WARN(gLogger)};
static LogStreamConsumer gLogError{LOG_ERROR(gLogger)};
static LogStreamConsumer gLogFatal{LOG_FATAL(gLogger)};

// TensorRT utility functions
inline unsigned int getElementSize(nvinfer1::DataType t)
{
    switch (t)
    {
        case nvinfer1::DataType::kINT32: return 4;
        case nvinfer1::DataType::kFLOAT: return 4;
        case nvinfer1::DataType::kHALF: return 2;
        case nvinfer1::DataType::kBOOL:
        case nvinfer1::DataType::kINT8: 
        case nvinfer1::DataType::kUINT8: return 1;  // Add this
        case nvinfer1::DataType::kINT64: return 8;  // Add this
        case nvinfer1::DataType::kFP8: return 1;    // Add this
        case nvinfer1::DataType::kBF16: return 2;   // Add this
        case nvinfer1::DataType::kINT4: return 1;   // Add this (packed)
        case nvinfer1::DataType::kFP4: return 1;    // Add this (packed)
    }
    throw std::runtime_error("Invalid DataType.");
    return 0;
}

inline int64_t volume(const nvinfer1::Dims& d) {
    return std::accumulate(d.d, d.d + d.nbDims, 1, std::multiplies<int64_t>());
}

// Utility function declarations
void setReportableSeverity(Logger::Severity severity);
std::vector<std::string> readFolder(const std::string &image_path);
std::map<int, std::string> readImageNetLabel(const std::string &fileName);
std::map<int, std::string> readClassLabel(const std::string &fileName);

// Class names for YOLOv11
const std::vector<std::string> CLASS_NAMES = {
    "pothole"
};

// Colors for visualization 
const std::vector<std::vector<unsigned int>> COLORS = {
    {0, 114, 189}
};

#endif //TRACKER_COMMON_H
