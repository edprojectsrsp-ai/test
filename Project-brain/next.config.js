/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',         // static export for Capacitor
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
  trailingSlash: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};
module.exports = nextConfig;
