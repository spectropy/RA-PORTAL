// server/middleware/errorHandler.js
export const errorHandler = (err, req, res, next) => {
  console.error('🚨 Server Error:', err);
  const status = res.statusCode === 200 ? 500 : res.statusCode;
  res.status(status).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined,
  });
};