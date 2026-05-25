import api from './client';

export const getUserProfile = (userId) =>
  api.get(`/api/v1/auth/user/${userId}`).then(res => res.data);

export const updateUserProfile = (userId, payload) =>
  api.patch(`/api/v1/auth/user/${userId}`, payload).then(res => res.data);
