import express from 'express';
import { body, validationResult } from 'express-validator';
import { getCollection } from '../db/client.js';
import rateLimit from 'express-rate-limit';
import { sendContactNotification } from '../services/contact-email.js';

const router = express.Router();
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { success: false, message: 'Too many messages from this address. Please try again later.' },
});

// POST contact message
router.post(
  '/',
  contactLimiter,
  [
    body('name')
      .trim()
      .notEmpty().withMessage('Name is required')
      .isLength({ min: 2, max: 255 }).withMessage('Name must be between 2 and 255 characters'),
    body('email')
      .trim()
      .isEmail().withMessage('Enter a valid email address')
      .isLength({ max: 255 }).withMessage('Email must be 255 characters or fewer'),
    body('subject')
      .trim()
      .notEmpty().withMessage('Subject is required')
      .isLength({ min: 3, max: 255 }).withMessage('Subject must be between 3 and 255 characters'),
    body('message')
      .trim()
      .notEmpty().withMessage('Message is required')
      .isLength({ min: 10, max: 5000 }).withMessage('Message must be between 10 and 5000 characters')
  ],
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Please correct the contact form fields and try again.',
        errors: errors.array().map(({ path, msg }) => ({ field: path, message: msg })),
      });
    }

    const { name, email, subject, message } = req.body;
    let result;
    let messages;
    const createdAt = new Date();
    try {
      messages = await getCollection('messages');
      result = await messages.insertOne({
        name,
        email,
        subject,
        message,
        read: false,
        notification_status: 'pending',
        created_at: createdAt,
      });
    } catch (error) {
      console.error('Could not save contact message:', error.stack || error.message);
      return res.status(503).json({
        success: false,
        message: 'We could not save your message because the message service is unavailable. Please try again later.',
      });
    }

    try {
      await sendContactNotification({ name, email, subject, message, createdAt });
    } catch (emailError) {
      console.error(`Contact notification failed for message ${result.insertedId}:`, emailError.stack || emailError.message);
      try {
        await messages.updateOne(
          { _id: result.insertedId },
          { $set: { notification_status: 'failed' } },
        );
      } catch (updateError) {
        console.error(`Could not record notification failure for message ${result.insertedId}:`, updateError.stack || updateError.message);
      }
      return res.status(202).json({
        success: true,
        message: 'Your message was received and saved, but the email alert could not be sent. Please do not submit it again.',
        data: {
          id: result.insertedId.toString(),
          created_at: createdAt,
          notificationStatus: 'failed',
        },
      });
    }

    try {
      await messages.updateOne(
        { _id: result.insertedId },
        { $set: { notification_status: 'sent', notification_sent_at: new Date() } },
      );
    } catch (err) {
      console.error(`Contact notification status update failed for message ${result.insertedId}:`, err.stack || err.message);
    }

    return res.status(201).json({
      success: true,
      message: 'Your message was received and the email alert was sent.',
      data: {
        id: result.insertedId.toString(),
        created_at: createdAt,
        notificationStatus: 'sent',
      },
    });
  }
);

export default router;
