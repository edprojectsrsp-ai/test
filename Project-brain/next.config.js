/** @type {import('next').NextConfig} */
const nextConfig = {
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
  trailingSlash: true,
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
};
module.exports = nextConfig;
