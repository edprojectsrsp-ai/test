/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'export',         // static export for Capacitor
  images: { unoptimized: true },
  outputFileTracingRoot: __dirname,
  trailingSlash: true,
};
module.exports = nextConfig;
