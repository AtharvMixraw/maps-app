#include "model.h"
#include "common.h"

void Model::onnxToTRTModel() {
    // create the builder
    nvinfer1::IBuilder *builder = nvinfer1::createInferBuilder(gLogger.getTRTLogger());
    assert(builder != nullptr);

    // TensorRT 8+ uses 0U instead of explicit batch flag
    auto network = builder->createNetworkV2(0U);
    auto config = builder->createBuilderConfig();

    auto parser = nvonnxparser::createParser(*network, gLogger.getTRTLogger());
    if (!parser->parseFromFile(onnx_file.c_str(), static_cast<int>(gLogger.getReportableSeverity()))) {
        gLogError << "Failure while parsing ONNX file" << std::endl;
    }
    
    // Build the engine - Updated API
    config->setMemoryPoolLimit(nvinfer1::MemoryPoolType::kWORKSPACE, 1ULL << 30); // 1 GB
    config->setFlag(nvinfer1::BuilderFlag::kFP16);

    std::cout << "start building engine" << std::endl;
    nvinfer1::IHostMemory* serializedModel = builder->buildSerializedNetwork(*network, *config);
    std::cout << "build engine done" << std::endl;
    assert(serializedModel);
    
    // save engine
    std::ofstream file;
    file.open(engine_file, std::ios::binary | std::ios::out);
    std::cout << "writing engine file..." << std::endl;
    file.write((const char*)serializedModel->data(), serializedModel->size());
    std::cout << "save engine file done" << std::endl;
    file.close();
    
    // Deserialize to get engine
    nvinfer1::IRuntime* runtime = nvinfer1::createInferRuntime(gLogger.getTRTLogger());
    engine = runtime->deserializeCudaEngine(serializedModel->data(), serializedModel->size());
    
    // Clean up - no more destroy() calls, use delete
    delete serializedModel;
    delete parser;
    delete network;
    delete config;
    delete builder;
}

bool Model::readTrtFile() {
    std::string cached_engine;
    std::fstream file;
    std::cout << "loading filename from:" << engine_file << std::endl;
    nvinfer1::IRuntime *trtRuntime;
    file.open(engine_file, std::ios::binary | std::ios::in);

    if (!file.is_open()) {
        std::cout << "read file error: " << engine_file << std::endl;
        return false;
    }

    while (file.peek() != EOF) {
        std::stringstream buffer;
        buffer << file.rdbuf();
        cached_engine.append(buffer.str());
    }
    file.close();

    trtRuntime = nvinfer1::createInferRuntime(gLogger.getTRTLogger());
    // Updated API - remove nullptr parameter
    engine = trtRuntime->deserializeCudaEngine(cached_engine.data(), cached_engine.size());
    std::cout << "deserialize done" << std::endl;
    
    return (engine != nullptr);
}

void Model::LoadEngine() {
    std::cout << "LoadEngine: Step 1 - Checking engine file..." << std::endl;
    
    // create and load engine
    std::fstream existEngine;
    existEngine.open(engine_file, std::ios::in);
    if (existEngine) {
        std::cout << "LoadEngine: Step 2 - Reading TRT file..." << std::endl;
        readTrtFile();
        assert(engine != nullptr);
        std::cout << "LoadEngine: Step 3 - Engine loaded successfully" << std::endl;
    } else {
        std::cout << "LoadEngine: Step 2 - Building engine from ONNX..." << std::endl;
        onnxToTRTModel();
        assert(engine != nullptr);
        std::cout << "LoadEngine: Step 3 - Engine built successfully" << std::endl;
    }

    std::cout << "LoadEngine: Step 4 - Creating execution context..." << std::endl;
    context = engine->createExecutionContext();
    assert(context != nullptr);
    std::cout << "LoadEngine: Step 5 - Context created successfully" << std::endl;

    // ====== DEBUG INFO (TensorRT 10 API) ======
    std::cout << "\n=== Engine Debug Info ===" << std::endl;
    int nbIOTensors = engine->getNbIOTensors();
    std::cout << "Number of IO tensors: " << nbIOTensors << std::endl;
    
    for (int i = 0; i < nbIOTensors; ++i) {
        const char* tensorName = engine->getIOTensorName(i);
        nvinfer1::Dims dims = engine->getTensorShape(tensorName);
        nvinfer1::DataType dtype = engine->getTensorDataType(tensorName);
        nvinfer1::TensorIOMode ioMode = engine->getTensorIOMode(tensorName);
        
        std::cout << "Tensor " << i << ": " << tensorName << std::endl;
        std::cout << "  Shape: ";
        for (int j = 0; j < dims.nbDims; ++j) {
            std::cout << dims.d[j];
            if (j < dims.nbDims - 1) std::cout << "x";
        }
        std::cout << std::endl;
        std::cout << "  DataType: " << (int)dtype << std::endl;
        std::cout << "  Is Input: " << (ioMode == nvinfer1::TensorIOMode::kINPUT) << std::endl;
    }
    std::cout << "========================\n" << std::endl;
    // ====== END DEBUG INFO ======

    std::cout << "LoadEngine: Step 6 - Allocating buffers..." << std::endl;
    // Get buffers - TensorRT 10 API
    bufferSize.resize(nbIOTensors);
    
    for (int i = 0; i < nbIOTensors; ++i) {
        const char* tensorName = engine->getIOTensorName(i);
        nvinfer1::Dims dims = engine->getTensorShape(tensorName);
        nvinfer1::DataType dtype = engine->getTensorDataType(tensorName);
        int64_t totalSize = volume(dims) * getElementSize(dtype);
        bufferSize[i] = totalSize;
        std::cout << "  Allocating tensor " << i << " (" << tensorName << "): " << totalSize << " bytes" << std::endl;
        cudaMalloc(&buffers[i], totalSize);
    }
    
    std::cout << "LoadEngine: Step 7 - Creating CUDA stream..." << std::endl;
    // get stream
    cudaStreamCreate(&stream);
    
    std::cout << "LoadEngine: Step 8 - Computing output size..." << std::endl;
    outSize = int(bufferSize[1] / sizeof(float) / BATCH_SIZE);
    std::cout << "  Output size: " << outSize << std::endl;
    
    std::cout << "LoadEngine: COMPLETE! ✓" << std::endl;
}
