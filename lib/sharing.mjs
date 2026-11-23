import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppError } from './files.mjs';

// These are local drafts. Server accounts, delivery and access enforcement are added with the server connection.
export async function readSharing(projectDirectory) {
  const value = await fs.readFile(path.join(projectDirectory, 'sharing.json'), 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return { invitations: [] }; throw error;
  });
  return { serverConnected: false, invitations: value.invitations };
}
export async function editInvitation(projectDirectory, method, invitationId, body) {
  const sharing = await readSharing(projectDirectory);
  let invitation = sharing.invitations.find(item => item.id === invitationId);
  if (method !== 'POST' && !invitation) throw new AppError('Vorgemerkte Einladung nicht gefunden.', 404);
  if (method === 'DELETE') sharing.invitations = sharing.invitations.filter(item => item.id !== invitationId);
  else {
    if (Object.keys(body).some(key => !['email', 'name', 'role'].includes(key))) throw new AppError('Nur Name, E-Mail und vorgesehene Rechte können geändert werden.');
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : invitation?.email;
    const name = body.name === undefined ? invitation?.name || '' : typeof body.name === 'string' ? body.name.trim() : null;
    const role = body.role ?? invitation?.role;
    if (!email || email.length > 254 || !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email)) throw new AppError('Bitte eine gültige E-Mail-Adresse eingeben.');
    if (name === null || name.length > 100 || /[\x00-\x1f\x7f]/.test(name)) throw new AppError('Der Name darf maximal 100 Zeichen enthalten.');
    if (!['reader', 'editor'].includes(role)) throw new AppError('Bitte Lesen oder Bearbeiten auswählen.');
    if (sharing.invitations.some(item => item.id !== invitationId && item.email === email)) throw new AppError('Diese Person ist bereits vorgemerkt.', 409);
    if (method === 'POST') {
      if (sharing.invitations.length >= 100) throw new AppError('Maximal 100 Einladungen können vorgemerkt werden.');
      invitation = { id: randomUUID(), createdAt: new Date().toISOString() }; sharing.invitations.push(invitation);
    }
    Object.assign(invitation, { email, name, role, status: 'planned' });
  }
  const file = path.join(projectDirectory, 'sharing.json');
  await fs.writeFile(file + '.tmp', JSON.stringify({ invitations: sharing.invitations }, null, 2)); await fs.rename(file + '.tmp', file);
  return sharing;
}
