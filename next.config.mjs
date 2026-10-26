/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.MORI_DESKTOP_BUILD ? '.next-desktop' : '.next',
  agentRules: false,
  allowedDevOrigins: ['127.0.0.1'],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
