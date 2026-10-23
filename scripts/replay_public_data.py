"""把公开数据集采样按实时节奏发到 MQTT，让系统按真实链路处理回放数据。

数据本身不带标签分数；分数由云侧会诊模型在诊断时计算。

前置：MQTT Broker 与后端已启动。
用法（项目根目录）：
    python scripts/replay_public_data.py pump-002 --dataset skab --file other/13.csv
    python scripts/replay_public_data.py motor-001 --dataset xjtu --bearing Bearing1_1
    python scripts/replay_public_data.py compressor-001 --dataset metropt --file path/to/metropt.csv
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

import paho.mqtt.client as mqtt

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.modules.replay.readers import (  # noqa: E402
    metropt_points,
    read_csv_rows,
    skab_points,
    xjtu_points,
)

SKAB_DIR = ROOT / "datasets" / "public" / "skab-repo" / "data"
XJTU_JSON = ROOT / "backend" / "app" / "data" / "xjtu_rul.json"


def load_points(args: argparse.Namespace) -> list[dict]:
    if args.dataset == "skab":
        path = SKAB_DIR / args.file
        if not path.exists():
            raise SystemExit(f"SKAB 文件不存在：{path}")
        return skab_points(read_csv_rows(path), f"SKAB {args.file}")
    if args.dataset == "xjtu":
        points = xjtu_points(XJTU_JSON, args.bearing)
        if not points:
            raise SystemExit(f"XJTU 轴承不存在或为空：{args.bearing}")
        return points
    path = Path(args.file)
    if not path.exists():
        raise SystemExit(f"MetroPT 文件不存在：{path}")
    return metropt_points(read_csv_rows(path), f"MetroPT-3 {path.name}")


def main() -> None:
    parser = argparse.ArgumentParser(description="公开数据集回放喂数")
    parser.add_argument("device_id", help="目标设备，如 pump-002")
    parser.add_argument("--dataset", choices=["skab", "xjtu", "metropt"], required=True)
    parser.add_argument("--file", default="other/13.csv", help="skab 相对路径或 metropt csv 路径")
    parser.add_argument("--bearing", default="Bearing1_1", help="xjtu 轴承编号")
    parser.add_argument("--interval", type=float, default=1.0, help="每条间隔秒数")
    parser.add_argument("--loops", type=int, default=0, help="循环次数，0 表示一直循环")
    parser.add_argument("--host", default="localhost")
    parser.add_argument("--port", type=int, default=1883)
    args = parser.parse_args()

    points = load_points(args)
    client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=f"replay-{args.device_id}")
    client.connect(args.host, args.port, keepalive=60)
    client.loop_start()
    topic = f"device/{args.device_id}/sensor_data"
    sent = 0
    loop = 0
    try:
        while args.loops <= 0 or loop < args.loops:
            loop += 1
            for point in points:
                payload = dict(point)
                payload["device_id"] = args.device_id
                payload["timestamp"] = time.time()
                client.publish(topic, json.dumps(payload, ensure_ascii=False), qos=1)
                sent += 1
                if sent % 30 == 0:
                    print(f"已发 {sent} 条（第 {loop} 轮）→ {topic}", flush=True)
                time.sleep(max(0.05, args.interval))
    except KeyboardInterrupt:
        pass
    finally:
        client.loop_stop()
        client.disconnect()
    print(f"结束，共 {sent} 条。")


if __name__ == "__main__":
    main()
