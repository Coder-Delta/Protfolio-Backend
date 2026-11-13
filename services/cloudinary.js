import dotenv from 'dotenv';
import { v2 as cloudinary } from 'cloudinary';

dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const isCloudinaryConfigured = () => Boolean(
  process.env.CLOUDINARY_CLOUD_NAME
  && process.env.CLOUDINARY_API_KEY
  && process.env.CLOUDINARY_API_SECRET,
);

export const uploadProjectBanner = (buffer) => new Promise((resolve, reject) => {
  const stream = cloudinary.uploader.upload_stream({
    folder: 'portfolio/projects',
    resource_type: 'image',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp', 'avif'],
    transformation: [{ quality: 'auto', fetch_format: 'auto' }],
  }, (error, result) => {
    if (error) return reject(error);
    if (!result?.secure_url || !result.public_id) {
      return reject(new Error('Cloudinary returned an incomplete upload result.'));
    }
    return resolve({ url: result.secure_url, publicId: result.public_id });
  });
  stream.end(buffer);
});

export const deleteProjectBanner = (publicId) => cloudinary.uploader.destroy(publicId, {
  resource_type: 'image',
  invalidate: true,
});
