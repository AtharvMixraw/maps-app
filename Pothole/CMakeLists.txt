cmake_minimum_required(VERSION 3.18)
project(yolov11_sort_tracking LANGUAGES CXX)

# Set C++ standard
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Build type
if(NOT CMAKE_BUILD_TYPE)
    set(CMAKE_BUILD_TYPE Release)
endif()

set(CMAKE_CXX_FLAGS "${CMAKE_CXX_FLAGS} -Wall -Wextra")
set(CMAKE_CXX_FLAGS_RELEASE "${CMAKE_CXX_FLAGS_RELEASE} -O3")

# OpenCV
find_package(OpenCV 4 REQUIRED)
include_directories(${OpenCV_INCLUDE_DIRS})
message(STATUS "OpenCV version: ${OpenCV_VERSION}")

# CURL - Add this BEFORE target linking
find_package(CURL REQUIRED)
message(STATUS "CURL found: ${CURL_LIBRARIES}")

# CUDA - Set toolkit path before enabling
if(NOT DEFINED CUDAToolkit_ROOT)
    if(EXISTS /usr/local/cuda)
        set(CUDAToolkit_ROOT /usr/local/cuda)
    elseif(EXISTS /usr)
        set(CUDAToolkit_ROOT /usr)
    endif()
endif()

enable_language(CUDA)
find_package(CUDAToolkit REQUIRED)
message(STATUS "CUDA version: ${CUDAToolkit_VERSION}")

# TensorRT
set(TensorRT_DIR /usr CACHE PATH "Path to TensorRT")

find_path(TensorRT_INCLUDE_DIR NvInfer.h
    HINTS ${TensorRT_DIR}
    PATH_SUFFIXES include
    PATHS /usr/include/x86_64-linux-gnu /usr/include)

find_library(TensorRT_LIBRARY nvinfer
    HINTS ${TensorRT_DIR}
    PATH_SUFFIXES lib lib64 lib/x86_64-linux-gnu
    PATHS /usr/lib/x86_64-linux-gnu /usr/lib)

find_library(TensorRT_ONNX_LIBRARY nvonnxparser
    HINTS ${TensorRT_DIR}
    PATH_SUFFIXES lib lib64 lib/x86_64-linux-gnu
    PATHS /usr/lib/x86_64-linux-gnu /usr/lib)

if(NOT TensorRT_INCLUDE_DIR OR NOT TensorRT_LIBRARY OR NOT TensorRT_ONNX_LIBRARY)
    message(FATAL_ERROR "TensorRT not found!")
endif()

include_directories(${TensorRT_INCLUDE_DIR})
message(STATUS "TensorRT include: ${TensorRT_INCLUDE_DIR}")
message(STATUS "TensorRT library: ${TensorRT_LIBRARY}")

# Include directories
include_directories(
    ${PROJECT_SOURCE_DIR}/includes
    ${PROJECT_SOURCE_DIR}/src
)

# Source files
set(LIBRARY_SOURCES
    src/yolo.cpp
    src/model.cpp
    src/common.cpp
    src/sort.cpp
    src/kalman_box_tracker.cpp
    src/kuhn_munkres.cpp
)

# Build shared library
add_library(${PROJECT_NAME} SHARED ${LIBRARY_SOURCES})

target_link_libraries(${PROJECT_NAME}
    ${OpenCV_LIBRARIES}
    CUDA::cudart
    ${TensorRT_LIBRARY}
    ${TensorRT_ONNX_LIBRARY}
)

# Build executable
add_executable(yolo_pipeline main.cpp)

# Link everything correctly (no PRIVATE on CURL)
target_link_libraries(yolo_pipeline
    ${PROJECT_NAME}
    ${OpenCV_LIBRARIES}
    CUDA::cudart
    ${TensorRT_LIBRARY}
    ${TensorRT_ONNX_LIBRARY}
    yaml-cpp
    CURL::libcurl
)