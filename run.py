import sys
import os
import uvicorn

def main():
    # 支持从命令行或环境变量指定端口，默认 8888
    port = 8888
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    elif os.environ.get("PORT"):
        port = int(os.environ.get("PORT"))

    print("=" * 60)
    print("  🚀 OIBoard - 跨平台算法刷题看板 (CF / 洛谷 / AcWing)")
    print("=" * 60)
    print(f"  ► 本地访问地址: http://127.0.0.1:{port}")
    print(f"  ► 备用访问地址: http://localhost:{port}")
    print("  ► 数据存储路径: ./data/oiboard.db (SQLite)")
    print("  ► 内存轻量化设计: 适用本地及 1C1G 海外 VPS")
    print("=" * 60)
    print("按 Ctrl+C 可停止服务\n")

    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=False,
        log_level="info"
    )

if __name__ == "__main__":
    main()
