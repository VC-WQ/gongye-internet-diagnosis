# -*- coding: utf-8 -*-
"""GPU 租用机远程操作 helper（paramiko 非交互密码登录）。

用法（在项目根目录运行）：
    python tmp/remote_helper.py probe      # 探环境（GPU/系统/python/torch/磁盘）
    python tmp/remote_helper.py upload     # 上传 NEU-DET 数据集 + 训练脚本
    python tmp/remote_helper.py train      # 启动训练（nohup 后台）
    python tmp/remote_helper.py status     # 查看训练日志尾部
    python tmp/remote_helper.py download   # 下载产物到本地 xjtu 目录
    python tmp/remote_helper.py run "cmd"  # 执行任意远程命令
"""
from __future__ import annotations

import os
import sys
import tarfile

import paramiko

HOST = os.environ.get("REMOTE_SSH_HOST", "connect.westb.seetacloud.com")
PORT = int(os.environ.get("REMOTE_SSH_PORT", "31049"))
USER = os.environ.get("REMOTE_SSH_USER", "root")
PWD = os.environ.get("REMOTE_SSH_PASSWORD", "")

# 远程工作目录（放在容量大的数据盘 autodl-tmp=50G，避免撑爆 30G 的 / overlay）
REMOTE_WORK = "/root/autodl-tmp/neu_det"
REMOTE_DATA_ROOT = f"{REMOTE_WORK}/NEU-DET"
REMOTE_SCRIPT = f"{REMOTE_WORK}/train_neu_det.py"

# 远程 python（miniconda3 base，python 命令不在 PATH，需用绝对路径）
REMOTE_PY = "/root/miniconda3/bin/python"

# 本地路径
LOCAL_DATASET = r"d:\企业云系统\工业互联网系统\datasets\NEU-DET"
LOCAL_SCRIPT = r"d:\企业云系统\工业互联网系统\scripts\train_neu_det.py"
LOCAL_FINISH = r"d:\企业云系统\工业互联网系统\scripts\finish_rtdetr.py"
LOCAL_EXPORT = r"d:\企业云系统\工业互联网系统\neu_det_export"

NOHUP_LOG = f"{REMOTE_WORK}/train.log"


def connect() -> paramiko.SSHClient:
    if not PWD:
        raise SystemExit("请先设置环境变量 REMOTE_SSH_PASSWORD，不要把密码写进代码。")
    c = paramiko.SSHClient()
    c.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    c.connect(HOST, PORT, USER, PWD, timeout=30, allow_agent=False, look_for_keys=False)
    return c


def run(c: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    _stdin, stdout, stderr = c.exec_command(cmd, timeout=timeout, get_pty=False)
    out = stdout.read().decode("utf-8", "replace")
    err = stderr.read().decode("utf-8", "replace")
    rc = stdout.channel.recv_exit_status()
    return rc, out, err


def sh(c: paramiko.SSHClient, cmd: str, timeout: int = 600) -> tuple[int, str, str]:
    print(f"$ {cmd}")
    rc, out, err = run(c, cmd, timeout)
    if out.strip():
        print(out.strip())
    if err.strip():
        print(f"[stderr] {err.strip()[:1500]}")
    print("-" * 60)
    return rc, out, err


def ensure_remote_dir(c: paramiko.SSHClient) -> None:
    run(c, f"mkdir -p {REMOTE_WORK}")


def cmd_probe(c: paramiko.SSHClient) -> None:
    sh(c, "nvidia-smi")
    sh(c, "python --version 2>&1; which python; pip --version 2>&1")
    sh(c, "pip list 2>/dev/null | grep -iE 'torch|ultralytics|opencv|numpy' ")
    sh(c, "df -h / /root /data 2>/dev/null")
    sh(c, "free -h; nproc")
    sh(c, "ls -la /root/ 2>/dev/null")


def _make_tarball(local_dir: str, tar_path: str) -> None:
    """把数据集目录打成 tar.gz（避免逐文件 SFTP 慢）。"""
    with tarfile.open(tar_path, "w:gz") as tf:
        tf.add(local_dir, arcname="NEU-DET")


def cmd_upload(c: paramiko.SSHClient) -> None:
    ensure_remote_dir(c)
    sftp = c.open_sftp()

    # 1) 上传训练脚本
    sftp.put(LOCAL_SCRIPT, REMOTE_SCRIPT)
    print(f"[上传] 脚本 -> {REMOTE_SCRIPT}")

    # 2) 数据集打成 tar.gz 上传后远程解压
    tar_local = os.path.join(os.path.dirname(LOCAL_DATASET), "_neu_det_tmp.tar.gz")
    tar_remote = f"{REMOTE_WORK}/neu_det.tar.gz"
    _make_tarball(LOCAL_DATASET, tar_local)
    size_mb = os.path.getsize(tar_local) / 1024 / 1024
    print(f"[上传] 数据集 {size_mb:.1f} MB -> {tar_remote}")
    sftp.put(tar_local, tar_remote)
    sftp.close()

    # 解压，目录结构变为 REMOTE_WORK/NEU-DET/NEU-DET（脚本 locate_dirs 兼容）
    rc, out, err = run(c, f"cd {REMOTE_WORK} && tar -xzf neu_det.tar.gz && ls -la")
    print(out.strip())
    if err.strip():
        print(err.strip()[:1000])
    run(c, f"rm -f {tar_remote}")
    os.remove(tar_local)
    print("[上传] 完成")


def cmd_sync(c: paramiko.SSHClient) -> None:
    """仅重新上传训练脚本（数据已存在时用，避免重传数据集）。"""
    ensure_remote_dir(c)
    sftp = c.open_sftp()
    sftp.put(LOCAL_SCRIPT, REMOTE_SCRIPT)
    sftp.close()
    print(f"[同步] 脚本 -> {REMOTE_SCRIPT}")


def cmd_install(c: paramiko.SSHClient) -> None:
    """安装 ultralytics（含 opencv 依赖），用阿里云镜像加速。"""
    sh(c, f"{REMOTE_PY} -m pip install -i https://mirrors.aliyun.com/pypi/simple/ ultralytics", timeout=300)


def cmd_train(c: paramiko.SSHClient) -> None:
    cmd = (
        f"cd {REMOTE_WORK} && "
        f"nohup {REMOTE_PY} train_neu_det.py --data-root {REMOTE_DATA_ROOT} "
        f"--out {REMOTE_WORK}/out --export {REMOTE_WORK}/export "
        f"--epochs 200 --imgsz 200 --rtdetr-imgsz 640 --batch 16 "
        f"> {NOHUP_LOG} 2>&1 & echo STARTED_PID=$!"
    )
    sh(c, cmd)


def cmd_status(c: paramiko.SSHClient) -> None:
    sh(c, f"tail -n 60 {NOHUP_LOG} 2>/dev/null")
    sh(c, "pgrep -af train_neu_det || echo 'NO_TRAIN_PROCESS'")


def cmd_download(c: paramiko.SSHClient) -> None:
    os.makedirs(LOCAL_EXPORT, exist_ok=True)
    sftp = c.open_sftp()
    rc, out, _ = run(c, f"find {REMOTE_WORK}/export -type f 2>/dev/null")
    files = [f for f in out.splitlines() if f.strip()]
    if not files:
        print("[下载] 远程暂无产物，训练可能尚未完成")
        sftp.close()
        return
    for rf in files:
        rel = os.path.relpath(rf, f"{REMOTE_WORK}/export")
        local = os.path.join(LOCAL_EXPORT, rel)
        os.makedirs(os.path.dirname(local), exist_ok=True)
        sftp.get(rf, local)
        print(f"[下载] {rel}")
    sftp.close()
    print(f"[下载] 完成 -> {LOCAL_EXPORT}")


def cmd_finish(c: paramiko.SSHClient) -> None:
    """补跑 RT-DETR 剩余 epoch + 双模型评测导出（上传 finish 脚本后 nohup 启动）。"""
    ensure_remote_dir(c)
    sftp = c.open_sftp()
    # 同步 train_neu_det.py（finish_rtdetr 依赖其 _evaluate_and_collect）
    sftp.put(LOCAL_SCRIPT, REMOTE_SCRIPT)
    # 上传 finish 脚本
    remote_finish = f"{REMOTE_WORK}/finish_rtdetr.py"
    sftp.put(LOCAL_FINISH, remote_finish)
    sftp.close()
    print(f"[同步] train_neu_det.py + finish_rtdetr.py -> {REMOTE_WORK}")
    cmd = (
        f"cd {REMOTE_WORK} && "
        f"nohup {REMOTE_PY} finish_rtdetr.py "
        f"> {REMOTE_WORK}/finish.log 2>&1 & echo FINISH_STARTED_PID=$!"
    )
    sh(c, cmd)


def main() -> None:
    action = sys.argv[1] if len(sys.argv) > 1 else "probe"
    c = connect()
    try:
        if action == "probe":
            cmd_probe(c)
        elif action == "install":
            cmd_install(c)
        elif action == "upload":
            cmd_upload(c)
        elif action == "sync":
            cmd_sync(c)
        elif action == "train":
            cmd_train(c)
        elif action == "status":
            cmd_status(c)
        elif action == "download":
            cmd_download(c)
        elif action == "finish":
            cmd_finish(c)
        elif action == "run":
            sh(c, " ".join(sys.argv[2:]))
        else:
            print(__doc__)
    finally:
        c.close()


if __name__ == "__main__":
    main()