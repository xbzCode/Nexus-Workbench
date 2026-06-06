/** @type {import('next').NextConfig} */
const nextConfig = {
  // 后端 API 代理（开发环境）
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backendUrl}/api/:path*`,
      },
    ];
  },

  // 修复 Windows 上 Watchpack 扫描 System Volume Information 的问题
  webpack: (config, { dev }) => {
    if (dev) {
      config.watchOptions = {
        ...config.watchOptions,
        ignored: [
          "**/System Volume Information/**",
          "**/node_modules/**",
        ],
      };
    }
    return config;
  },

};

module.exports = nextConfig;
