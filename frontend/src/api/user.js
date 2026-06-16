import api from './client';

export const getUserProfile = () =>
  api.get(`/api/v1/auth/me`).then(res => res.data);

export const updateUserProfile = (userId, payload) =>
  api.patch(`/api/v1/auth/me`, payload).then(res => res.data);
