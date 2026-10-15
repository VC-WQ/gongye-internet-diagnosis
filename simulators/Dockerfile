# 虚拟设备模拟器（6 台异构设备，通过 MQTT 上报）
FROM python:3.11-slim
WORKDIR /app
RUN pip install --no-cache-dir paho-mqtt
COPY virtual_device.py edge_inference.py ./
CMD ["python", "edge_inference.py", "--use-mqtt", "--host", "mqtt", "--port", "1883"]