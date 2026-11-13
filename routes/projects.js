import express from 'express';
import multer from 'multer';
import rateLimit from 'express-rate-limit';
import { body, validationResult } from 'express-validator';
import { getCollection } from '../db/client.js';
import { requireAdmin } from '../middleware/admin-auth.js';
import { deleteProjectBanner, isCloudinaryConfigured, uploadProjectBanner } from '../services/cloudinary.js';

const router = express.Router();
const projectCreationLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many projects created. Please try again later.' },
});
const acceptedImageTypes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif']);
const bannerUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 3, parts: 4, fieldSize: 8 * 1024 },
  fileFilter(req, file, callback) {
    if (!acceptedImageTypes.has(file.mimetype)) {
      return callback(new Error('Banner must be a JPEG, PNG, WebP, or AVIF image.'));
    }
    return callback(null, true);
  },
}).single('banner');
const parseBannerUpload = (req, res, next) => bannerUpload(req, res, (error) => {
  if (!error) return next();
  const message = error.code === 'LIMIT_FILE_SIZE'
    ? 'Banner image must be 5 MB or smaller.'
    : error.message;
  return res.status(400).json({ success: false, message });
});

export const presentProject = (project) => ({
  id: project.id,
  title: project.title,
  description: project.description,
  featured: Boolean(project.featured),
  display_order: project.display_order || 0,
  created_at: project.created_at,
  banner: project.banner || null,
  live_link: project.live_link || null,
  link: project.live_link || null,
  image: project.banner || null,
});

// GET all projects
router.get('/', async (req, res) => {
  try {
    const projects = await getCollection('projects');
    const result = await projects.find({ source: 'manual' }, {
      projection: { _id: 0 },
    }).sort({ featured: -1, display_order: 1 }).toArray();

    res.json({
      success: true,
      data: result.map(presentProject),
    });
  } catch (err) {
    console.error('Error fetching projects:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch projects' 
    });
  }
});

router.post(
  '/',
  projectCreationLimiter,
  requireAdmin,
  parseBannerUpload,
  [
    body('title').trim().isLength({ min: 2, max: 255 }),
    body('description').trim().isLength({ min: 10, max: 5000 }),
    body('liveLink').trim().isLength({ min: 1, max: 2048 }).isURL({ protocols: ['http', 'https'], require_protocol: true }),
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation failed',
        errors: errors.array(),
      });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'A project banner image is required.' });
    }
    if (!isCloudinaryConfigured()) {
      return res.status(503).json({ success: false, message: 'Cloudinary is not configured on the backend.' });
    }

    let uploadedBanner;
    try {
      uploadedBanner = await uploadProjectBanner(req.file.buffer);
    } catch (error) {
      console.error('Cloudinary project banner upload failed:', error.message);
      return res.status(502).json({ success: false, message: 'Could not upload the banner image. Please try again.' });
    }

    try {
      const projects = await getCollection('projects');
      const counters = await getCollection('counters');
      const [highestProject, lastOrderedProject] = await Promise.all([
        projects.find({}, { projection: { id: 1 } }).sort({ id: -1 }).limit(1).next(),
        projects.find({}, { projection: { display_order: 1 } }).sort({ display_order: -1 }).limit(1).next(),
      ]);
      await counters.updateOne(
        { _id: 'projects' },
        { $max: { sequence: highestProject?.id || 0 } },
        { upsert: true },
      );
      const counter = await counters.findOneAndUpdate(
        { _id: 'projects' },
        { $inc: { sequence: 1 } },
        { returnDocument: 'after' },
      );
      const createdAt = new Date();
      const project = {
        id: counter.sequence,
        title: req.body.title,
        description: req.body.description,
        banner: uploadedBanner.url,
        banner_public_id: uploadedBanner.publicId,
        live_link: req.body.liveLink,
        source: 'manual',
        featured: false,
        display_order: (lastOrderedProject?.display_order || 0) + 1,
        created_at: createdAt,
        updated_at: createdAt,
      };
      await projects.insertOne(project);
      return res.status(201).json({
        success: true,
        message: 'Project created successfully.',
        data: presentProject(project),
      });
    } catch (error) {
      try {
        await deleteProjectBanner(uploadedBanner.publicId);
      } catch (cleanupError) {
        console.error('Failed to remove project banner after database error:', cleanupError.message);
      }
      if (error.code === 11000) {
        return res.status(409).json({
          success: false,
          message: 'A project with this title already exists.',
        });
      }
      console.error('Error creating project:', error.message);
      return res.status(500).json({
        success: false,
        message: 'Failed to create project.',
      });
    }
  },
);

// GET single project
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!/^[1-9]\d*$/.test(id)) {
      return res.status(400).json({ success: false, message: 'Project id must be a positive integer' });
    }
    const projects = await getCollection('projects');
    const project = await projects.findOne(
      { id: Number(id), source: 'manual' },
      { projection: { _id: 0 } },
    );

    if (!project) {
      return res.status(404).json({ 
        success: false, 
        message: 'Project not found' 
      });
    }
    
    res.json({
      success: true,
      data: presentProject(project),
    });
  } catch (err) {
    console.error('Error fetching project:', err);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch project' 
    });
  }
});

export default router;
