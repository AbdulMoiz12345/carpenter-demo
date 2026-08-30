/** @type {import('next').NextConfig} */
const nextConfig = {
  // Demo pages must render per-request: tenant config is read at
  // request time, so nothing can be statically pre-built.
  images: { remotePatterns: [{ protocol: 'https', hostname: '**' }] }
};
export default nextConfig;
