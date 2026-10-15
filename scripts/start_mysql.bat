@echo off
REM 启动 MySQL（D 盘免安装版，root 密码 123456，库 industrial_diagnosis）
start "MySQL" /min "D:\MySQL\bin\mysqld.exe" --defaults-file="D:\MySQL\my.ini" --console