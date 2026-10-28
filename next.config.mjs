/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: '.next-desktop',
  agentRules: false,
  devIndicators: false,
  allowedDevOrigins: ['127.0.0.1'],
  images: {
    unoptimized: true,
  },
}

export default nextConfig
