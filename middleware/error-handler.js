export const getRequestErrorResponse = (error) => {
  if (error.type === 'entity.parse.failed') {
    return { status: 400, message: 'The request contains invalid JSON. Please check the submitted data.' };
  }
  if (error.type === 'entity.too.large') {
    return { status: 413, message: 'The submitted data is too large. Please reduce it and try again.' };
  }
  if (error.message === 'Origin is not allowed by CORS') {
    return { status: 403, message: 'This website is not allowed to access the API.' };
  }

  const status = error.statusCode || error.status;
  if (Number.isInteger(status) && status >= 400 && status < 500 && error.expose) {
    return { status, message: error.message };
  }
  return { status: 500, message: 'The server encountered an unexpected error. Please try again later.' };
};

export const errorHandler = (error, req, res, next) => {
  if (res.headersSent) return next(error);

  const response = getRequestErrorResponse(error);
  if (response.status >= 500) {
    console.error('Request error:', error.stack || error.message);
  }
  return res.status(response.status).json({ success: false, message: response.message });
};
