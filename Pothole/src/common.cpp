// common.cpp - Implementation of common utility functions
// Compatible with YOLOv11

#include "common.h"
#include <filesystem>
#include <algorithm>
#include <iostream>

namespace fs = std::filesystem;

// Set TensorRT logging severity for all loggers
void setReportableSeverity(Logger::Severity severity) {
    gLogger.setReportableSeverity(severity);
    gLogVerbose.setReportableSeverity(severity);
    gLogInfo.setReportableSeverity(severity);
    gLogWarning.setReportableSeverity(severity);
    gLogError.setReportableSeverity(severity);
    gLogFatal.setReportableSeverity(severity);
}

// Read all image files from a folder
std::vector<std::string> readFolder(const std::string& image_path) {
    std::vector<std::string> image_names;
    
    // Check if directory exists
    if (!fs::exists(image_path) || !fs::is_directory(image_path)) {
        std::cerr << "Error: Directory does not exist: " << image_path << std::endl;
        return image_names;
    }
    
    // Supported image extensions
    const std::vector<std::string> valid_extensions = {
        ".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff", ".webp"
    };
    
    // Iterate through directory
    for (const auto& entry : fs::directory_iterator(image_path)) {
        if (entry.is_regular_file()) {
            std::string filepath = entry.path().string();
            std::string extension = entry.path().extension().string();
            
            // Convert extension to lowercase
            std::transform(extension.begin(), extension.end(), extension.begin(), ::tolower);
            
            // Check if extension is valid
            if (std::find(valid_extensions.begin(), valid_extensions.end(), extension) 
                != valid_extensions.end()) {
                image_names.push_back(filepath);
            }
        }
    }
    
    // Sort filenames for consistent ordering
    std::sort(image_names.begin(), image_names.end());
    
    return image_names;
}

// Read ImageNet labels from file (legacy function, not needed for COCO/YOLOv11)
std::map<int, std::string> readImageNetLabel(const std::string& fileName) {
    std::map<int, std::string> imagenet_label;
    std::ifstream file(fileName);
    
    if (!file.is_open()) {
        std::cerr << "Error: Cannot open file: " << fileName << std::endl;
        return imagenet_label;
    }
    
    std::string line;
    while (std::getline(file, line)) {
        // Expected format: "0: 'tench, Tinca tinca'"
        size_t colon_pos = line.find(":");
        if (colon_pos == std::string::npos) continue;
        
        std::string index_str = line.substr(0, colon_pos);
        
        size_t first_quote = line.find("'", colon_pos);
        size_t last_quote = line.find_last_of("'");
        
        if (first_quote == std::string::npos || last_quote == std::string::npos || 
            first_quote >= last_quote) continue;
        
        std::string label = line.substr(first_quote + 1, last_quote - first_quote - 1);
        
        try {
            int index = std::stoi(index_str);
            imagenet_label[index] = label;
        } catch (const std::exception& e) {
            std::cerr << "Warning: Failed to parse line: " << line << std::endl;
        }
    }
    
    file.close();
    return imagenet_label;
}

// Read class labels from file (one class per line)
// This is what YOLOv11 typically uses for COCO classes
std::map<int, std::string> readClassLabel(const std::string& fileName) {
    std::map<int, std::string> class_label;
    std::ifstream file(fileName);
    
    if (!file.is_open()) {
        std::cerr << "Error: Cannot open file: " << fileName << std::endl;
        return class_label;
    }
    
    std::string line;
    int index = 0;
    
    while (std::getline(file, line)) {
        // Remove trailing whitespace and newlines
        line.erase(line.find_last_not_of(" \n\r\t") + 1);
        
        // Skip empty lines
        if (!line.empty()) {
            class_label[index] = line;
            index++;
        }
    }
    
    file.close();
    return class_label;
}
