import express from 'express';
import helmet from 'helmet';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { hashPassword, verifyPassword, sessionHash, readSession, sessionCookie } from './auth.js';
import { validateReport, statuses, transitions, validateWard } from './validation.js';
import { isAllowedOrigin } from './origin.js';

const publicUser = user => ({ id: user.id, name: user.name, role: user.role });
const publicProfile = user => ({
  id: user.id, name: user.name, role: user.role,
  province: user.province || null, district: user.district || null, municipality: user.municipality || null,
  ward: user.ward || null, locality: user.locality || null, addressLat: user.addressLat || null, addressLng: user.addressLng || null
});
const reportInclude = { area: true, job: true, events: { include: { actor: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'asc' } }, incidentAssignments: { where: { active: true }, include: { team: { include: { organization: true } } } } };
function presentReport(report, isAdmin = false, isOwner = false) {
  const { photoPath, reporterId, job, ...rest } = report;
  return {
    ...rest, ...(isAdmin || isOwner ? {} : { latitude: null, longitude: null, locality: null, ward: null }), analysis: job && {
      status: job.status, attempts: job.attempts,
      result: isAdmin ? job.result : undefined, weather: isAdmin ? job.weather : undefined,
      model: isAdmin ? job.model : undefined, error: isAdmin ? job.error : undefined,
      completedAt: job.completedAt
    }
  };
}

export function createApp(db) {
  const app = express();
  const uploadDirectory = path.resolve(process.env.UPLOAD_DIR || './data/uploads');
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet({
    frameguard: false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        'frame-ancestors': null,
        'upgrade-insecure-requests': null,
        'img-src': ["'self'", 'data:', 'blob:', 'https:'],
        'connect-src': ["'self'", 'https:', 'wss:', 'ws:'],
        'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        'style-src': ["'self'", 'https:', "'unsafe-inline'"],
        'font-src': ["'self'", 'https:', 'data:'],
      },
    },
    crossOriginEmbedderPolicy: false,
    crossOriginResourcePolicy: false,
    crossOriginOpenerPolicy: false,
  }));
  app.use('/api', (req, res, next) => {
    const origin = req.headers.origin;
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !isAllowedOrigin(origin)) {
      return res.status(403).json({ error: 'Request origin is not allowed.' });
    }
    res.set('Cache-Control', 'no-store'); next();
  });

  const getClientIp = (req) => {
    const forwarded = req.headers['forwarded'];
    if (typeof forwarded === 'string') {
      const match = forwarded.match(/for=(?:"?\[?)([a-zA-Z0-9.:_%-]+)/i);
      if (match && match[1]) {
        return match[1];
      }
    }
    return req.ip;
  };

  app.use('/api', rateLimit({
    windowMs: 60000,
    limit: 120,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    message: { error: 'Too many requests. Please try again shortly.' },
  }));
  app.use(express.json({ limit: '5mb' }));
  const authLimit = rateLimit({
    windowMs: 15 * 60000,
    limit: 20,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => ipKeyGenerator(getClientIp(req)),
    validate: { xForwardedForHeader: false, forwardedHeader: false },
    message: { error: 'Too many sign-in attempts. Please try again later.' },
  });

  async function startSession(user, res) {
    const token = randomBytes(32).toString('hex');
    await db.session.create({ data: { id: sessionHash(token), userId: user.id, expiresAt: new Date(Date.now() + 7 * 86400000) } });
    res.setHeader('Set-Cookie', sessionCookie(token));
  }
  app.get('/api/health', async (req, res) => { await db.$queryRaw`SELECT 1`; res.json({ status: 'ok' }); });
  app.post('/api/auth/register', authLimit, async (req, res) => {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 80 || typeof email !== 'string' ||
      email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) ||
      typeof password !== 'string' || password.length < 12 || password.length > 128) {
      return res.status(400).json({ error: 'Enter a name, valid email, and password of 12–128 characters.' });
    }
    const normalizedEmail = email.trim().toLowerCase();
    const existing = await db.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      return res.status(409).json({ error: 'An account with this email already exists.', code: 'ACCOUNT_EXISTS' });
    }
    try {
      const user = await db.user.create({ data: { name: name.trim(), email: normalizedEmail, passwordHash: await hashPassword(password) } });
      await startSession(user, res); res.status(201).json(publicUser(user));
    } catch (error) {
      if (error.code === 'P2002') return res.status(409).json({ error: 'An account with this email already exists.', code: 'ACCOUNT_EXISTS' });
      throw error;
    }
  });
  app.post('/api/auth/login', authLimit, async (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string' || password.length > 128) {
      return res.status(400).json({ error: 'Enter your email and password.' });
    }
    const user = await db.user.findUnique({ where: { email: email.trim().toLowerCase() } });
    const fallback = '00000000000000000000000000000000:' + '00'.repeat(64);
    const valid = await verifyPassword(password, user?.passwordHash || fallback);
    if (!user || !valid) return res.status(401).json({ error: 'Email or password is incorrect.' });
    await startSession(user, res); res.json(publicUser(user));
  });
  app.get('/api/public/stats', async (req, res) => {
    try {
      const [total, reported, verified, responding, resolved] = await Promise.all([
        db.report.count(),
        db.report.count({ where: { status: 'Reported' } }),
        db.report.count({ where: { status: 'Verified' } }),
        db.report.count({ where: { status: 'Responding' } }),
        db.report.count({ where: { status: 'Resolved' } }),
      ]);
      const orgsCount = await db.responseOrganization.count({ where: { active: true } });
      const teamsCount = await db.responseTeam.count({ where: { active: true } });
      res.json({
        total,
        reported,
        verified,
        responding,
        resolved,
        organizations: orgsCount,
        teams: teamsCount,
        lastUpdated: new Date().toISOString()
      });
    } catch {
      res.status(500).json({ error: 'Failed to retrieve public statistics.' });
    }
  });
  app.get('/api/public/incidents', async (req, res) => {
    try {
      const where = {};
      if (typeof req.query.hazard === 'string' && req.query.hazard) where.hazard = req.query.hazard;
      if (typeof req.query.status === 'string' && req.query.status) where.status = req.query.status;
      if (typeof req.query.severity === 'string' && req.query.severity) where.severity = req.query.severity;
      const reports = await db.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 30,
        select: {
          id: true,
          hazard: true,
          severity: true,
          status: true,
          createdAt: true,
          incidentAt: true,
          latitude: true,
          longitude: true,
          district: true,
          municipality: true,
          area: { select: { id: true, name: true, latitude: true, longitude: true } }
        }
      });
      // Public feed exposes only ward-level precision. Precise free-text locality
      // and full-precision coordinates are withheld, matching presentReport's
      // treatment of these fields for non-owners.
      res.json(reports.map(({ latitude, longitude, ...rest }) => ({
        ...rest,
        latitude: latitude == null ? null : Math.round(latitude * 100) / 100,
        longitude: longitude == null ? null : Math.round(longitude * 100) / 100,
      })));
    } catch {
      res.status(500).json({ error: 'Failed to retrieve public incidents.' });
    }
  });
  app.use('/api', async (req, res, next) => {
    const token = readSession(req);
    const session = token && await db.session.findUnique({ where: { id: sessionHash(token) }, include: { user: true } });
    if (!session || session.expiresAt < new Date()) return res.status(401).json({ error: 'Please sign in.' });
    req.user = session.user; next();
  });
  app.get('/api/auth/me', (req, res) => res.json(publicUser(req.user)));
  app.get('/api/auth/profile', (req, res) => res.json(publicProfile(req.user)));
  app.patch('/api/auth/profile', async (req, res) => {
    const body = req.body || {};
    const allowed = ['province', 'district', 'municipality', 'ward', 'locality'];
    const data = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        if (typeof body[key] !== 'string' || body[key].length > 120) return res.status(400).json({ error: `Enter a valid ${key}.` });
        data[key] = body[key].trim() || null;
      }
    }
    // wardOther: when ward is 'Other', store wardOther text as a suffix in locality
    if (data.ward === 'Other' && body.wardOther !== undefined) {
      if (typeof body.wardOther !== 'string' || body.wardOther.length > 120) return res.status(400).json({ error: 'Enter a valid area name.' });
      // wardOther is stored separately; we keep ward as 'Other' and locality unchanged
    }
    const wardError = validateWard(data.ward ?? req.user.ward, body.wardOther);
    if (wardError) return res.status(400).json({ error: wardError });
    for (const key of ['addressLat', 'addressLng']) {
      if (body[key] !== undefined && body[key] !== null && body[key] !== '') {
        const n = Number(body[key]);
        if (!Number.isFinite(n)) return res.status(400).json({ error: 'Enter valid coordinates.' });
        data[key] = n;
      } else if (body[key] === null || body[key] === '') {
        data[key] = null;
      }
    }
    const updated = await db.user.update({ where: { id: req.user.id }, data });
    res.json(publicProfile(updated));
  });
  app.post('/api/auth/logout', async (req, res) => {
    await db.session.deleteMany({ where: { id: sessionHash(readSession(req)) } });
    res.setHeader('Set-Cookie', sessionCookie('', 0)); res.json({ success: true });
  });
  app.get('/api/areas', async (req, res) => res.json(await db.area.findMany({ orderBy: { name: 'asc' } })));
  app.get('/api/subscriptions', async (req, res) => res.json((await db.subscription.findMany({ where: { userId: req.user.id } })).map(item => item.areaId)));
  app.put('/api/subscriptions', async (req, res) => {
    const areaIds = req.body?.areaIds;
    if (!Array.isArray(areaIds) || areaIds.length > 100 || areaIds.some(id => typeof id !== 'string') || new Set(areaIds).size !== areaIds.length) {
      return res.status(400).json({ error: 'Choose valid areas.' });
    }
    if (await db.area.count({ where: { id: { in: areaIds } } }) !== areaIds.length) return res.status(400).json({ error: 'An area does not exist.' });
    await db.$transaction(async tx => {
      await tx.subscription.deleteMany({ where: { userId: req.user.id } });
      await tx.subscription.createMany({ data: areaIds.map(areaId => ({ areaId, userId: req.user.id })) });
    });
    res.json(areaIds);
  });
  app.get('/api/notifications', async (req, res) => res.json(await db.notification.findMany({ where: { userId: req.user.id }, orderBy: { createdAt: 'desc' }, take: 100 })));
  app.patch('/api/notifications/:id', async (req, res) => {
    const result = await db.notification.updateMany({ where: { id: req.params.id, userId: req.user.id }, data: { readAt: new Date() } });
    if (!result.count) return res.status(404).json({ error: 'Notification not found.' });
    res.json({ success: true });
  });
  async function assignedAreas(user) {
    return (await db.adminArea.findMany({ where: { userId: user.id } })).map(item => item.areaId);
  }
  function adminOnly(req, res, next) {
    if (req.user.role !== 'ADMIN') return res.status(403).json({ error: 'Administrator access is required.' });
    next();
  }
  app.get('/api/reports', async (req, res) => {
    const where = req.query.areaId ? { areaId: String(req.query.areaId) } : {};
    const reports = await db.report.findMany({ where, include: reportInclude, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(reports.map(report => presentReport(report, false, report.reporterId === req.user.id)));
  });
  app.get('/api/admin/reports', adminOnly, async (req, res) => {
    const reports = await db.report.findMany({ where: { areaId: { in: await assignedAreas(req.user) } }, include: reportInclude, orderBy: { createdAt: 'desc' }, take: 100 });
    res.json(reports.map(report => presentReport(report, true)));
  });
  app.get('/api/admin/analytics', adminOnly, async (req, res) => {
    const reports = await db.report.findMany({ where: { areaId: { in: await assignedAreas(req.user) } }, select: { status: true, hazard: true, severity: true, areaId: true } });
    const count = key => Object.fromEntries([...new Set(reports.map(item => item[key]))].map(value => [value, reports.filter(item => item[key] === value).length]));
    res.json({ total: reports.length, byStatus: count('status'), byType: count('hazard'), bySeverity: count('severity'), byArea: count('areaId') });
  });
  app.get('/api/admin/teams', adminOnly, async (req, res) => res.json(await db.responseTeam.findMany({ where: { active: true, organization: { active: true } }, include: { organization: true, members: { include: { user: { select: { id: true, name: true, email: true } } } } }, orderBy: { name: 'asc' } })));
  app.get('/api/admin/organizations', adminOnly, async (req, res) => res.json(await db.responseOrganization.findMany({ include: { teams: { include: { members: { include: { user: { select: { id: true, name: true } } } } } } }, orderBy: { name: 'asc' } })));
  app.get('/api/admin/users', adminOnly, async (req, res) => res.json(await db.user.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, email: true, role: true, createdAt: true } })));
  app.patch('/api/admin/users/:id/role', adminOnly, async (req, res) => {
    const { role } = req.body || {};
    if (!['RESIDENT', 'RESPONDER', 'ADMIN'].includes(role)) return res.status(400).json({ error: 'Invalid role. Choose RESIDENT, RESPONDER, or ADMIN.' });
    if (req.params.id === req.user.id) return res.status(400).json({ error: 'You cannot change your own role.' });
    const target = await db.user.findUnique({ where: { id: req.params.id } });
    if (!target) return res.status(404).json({ error: 'User not found.' });
    await db.user.update({ where: { id: req.params.id }, data: { role } });
    res.json({ success: true });
  });
  app.get('/api/responder/assignments', async (req, res) => {
    if (req.user.role !== 'RESPONDER') return res.status(403).json({ error: 'Responder access required.' });
    const memberships = await db.teamMember.findMany({ where: { userId: req.user.id } });
    const teamIds = memberships.map(m => m.teamId);
    const assignments = await db.incidentAssignment.findMany({
      where: { teamId: { in: teamIds }, active: true },
      include: { report: { include: { area: true, events: { include: { actor: { select: { id: true, name: true, role: true } } }, orderBy: { createdAt: 'asc' } } } }, team: { include: { organization: true } } },
      orderBy: { assignedAt: 'desc' }
    });
    res.json(assignments);
  });
  app.post('/api/admin/organizations', adminOnly, async (req, res) => {
    const { name, type, jurisdiction } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || name.length > 120 || typeof type !== 'string' || !type.trim() || type.length > 80) return res.status(400).json({ error: 'Enter an organization name and type.' });
    res.status(201).json(await db.responseOrganization.create({ data: { name: name.trim(), type: type.trim(), jurisdiction: typeof jurisdiction === 'string' ? jurisdiction.trim().slice(0, 160) : null, createdById: req.user.id } }));
  });
  app.post('/api/admin/organizations/:id/teams', adminOnly, async (req, res) => {
    const name = req.body?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > 120) return res.status(400).json({ error: 'Enter a team name.' });
    const org = await db.responseOrganization.findUnique({ where: { id: req.params.id } });
    if (!org?.active) return res.status(404).json({ error: 'Active organization not found.' });
    res.status(201).json(await db.responseTeam.create({ data: { organizationId: org.id, name: name.trim() } }));
  });
  app.put('/api/admin/teams/:id/members/:userId', adminOnly, async (req, res) => {
    const [team, member] = await Promise.all([
      db.responseTeam.findFirst({ where: { id: req.params.id, active: true, organization: { active: true } } }),
      db.user.findUnique({ where: { id: req.params.userId }, select: { id: true, role: true } }),
    ]);
    if (!team || !member) return res.status(404).json({ error: 'Active team or user not found.' });
    if (member.role !== 'RESPONDER') return res.status(400).json({ error: 'Only an account provisioned with the responder role can join a response team.' });
    await db.teamMember.upsert({ where: { teamId_userId: { teamId: team.id, userId: member.id } }, create: { teamId: team.id, userId: member.id }, update: {} });
    res.json({ success: true });
  });
  app.get('/api/reports/:id/photo', async (req, res) => {
    const report = await db.report.findUnique({ where: { id: req.params.id } });
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    const isOwner = report.reporterId === req.user.id;
    const isAssignedAdmin = req.user.role === 'ADMIN' && (await assignedAreas(req.user)).includes(report.areaId);
    const isAssignedResponder = req.user.role === 'RESPONDER' && !!(await db.teamMember.findFirst({ where: { userId: req.user.id, team: { assignments: { some: { reportId: report.id, active: true } } } } }));
    if (!isOwner && !isAssignedAdmin && !isAssignedResponder) return res.status(403).json({ error: 'You are not allowed to view this evidence.' });
    const file = path.join(uploadDirectory, path.basename(report.photoPath));
    if (!existsSync(file)) {
      // Seeded demo reports have no stored photo; show a neutral placeholder instead of a 500 error.
      res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="400" viewBox="0 0 640 400"><rect width="640" height="400" fill="#e5e7eb"/><text x="320" y="205" font-family="Arial,sans-serif" font-size="22" fill="#6b7280" text-anchor="middle">Demo report - no photo stored</text></svg>');
      return;
    }
    res.sendFile(file);
  });
  app.post('/api/reports', async (req, res) => {
    const body = req.body || {};
    let area = typeof body.areaId === 'string' && body.areaId !== '' ? await db.area.findUnique({ where: { id: body.areaId } }) : null;
    if (!area && body.district) {
      area = await db.area.findFirst({ where: { name: { contains: body.district } } });
    }
    if (!area) {
      area = await db.area.findFirst();
    }
    if (!area) return res.status(400).json({ error: 'Choose a valid area.' });
    const error = validateReport({ ...body, area: area.name });
    if (error) return res.status(400).json({ error });
    let photo;
    try {
      photo = await sharp(Buffer.from(body.photo.split(',')[1], 'base64'), { limitInputPixels: 40000000 })
        .rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    } catch { return res.status(400).json({ error: 'The photo cannot be decoded. Choose another image.' }); }
    const photoPath = `${randomUUID()}.jpg`;
    await mkdir(uploadDirectory, { recursive: true });
    await writeFile(path.join(uploadDirectory, photoPath), photo);
    try {
      // Save the report, job, and notifications in one transaction.
      const report = await db.$transaction(async tx => {
        // Resolve ward: if 'Other' store 'Other', frontend wardOther used only for locality suggestions
        const wardValue = body.ward && body.ward !== '' ? body.ward : null;
        const report = await tx.report.create({
          data: {
            hazard: body.hazard, description: body.description.trim(),
            photoPath, areaId: area.id, reporterId: req.user.id, severity: body.severity || 'Medium',
            province: body.province?.trim() || null,
            locality: body.locality?.trim() || null, district: body.district?.trim() || null,
            municipality: body.municipality?.trim() || null, ward: wardValue,
            latitude: body.latitude === '' || body.latitude == null ? null : Number(body.latitude),
            longitude: body.longitude === '' || body.longitude == null ? null : Number(body.longitude),
            incidentAt: body.incidentAt ? new Date(body.incidentAt) : null, job: { create: {} }
          }
        });
        await tx.incidentEvent.create({ data: { reportId: report.id, actorId: req.user.id, type: 'REPORT_SUBMITTED', newStatus: 'Reported' } });
        const subscriptions = await tx.subscription.findMany({ where: { areaId: area.id } });
        const administrators = await tx.adminArea.findMany({ where: { areaId: area.id } });
        const recipients = new Set([...subscriptions, ...administrators].map(item => item.userId));
        await tx.notification.createMany({
          data: [...recipients].map(userId => ({
            userId, reportId: report.id,
            message: `Unverified observation: ${report.hazard} in ${area.name}. Administrative review is pending.`
          }))
        });
        return report;
      });
      res.status(201).json({ id: report.id });
    } catch (error) { await unlink(path.join(uploadDirectory, photoPath)).catch(() => { }); throw error; }
  });
  app.patch('/api/reports/:id', adminOnly, async (req, res) => {
    if (!statuses.includes(req.body?.status)) return res.status(400).json({ error: 'Invalid review status.' });
    const report = await db.report.findFirst({ where: { id: req.params.id, areaId: { in: await assignedAreas(req.user) } } });
    if (!report) return res.status(404).json({ error: 'Report not found in your assigned areas.' });
    if (!transitions[report.status]?.includes(req.body.status)) return res.status(409).json({ error: `Cannot change an incident from ${report.status} to ${req.body.status}.` });
    if (req.body.status === 'Rejected' && (typeof req.body.reason !== 'string' || !req.body.reason.trim() || req.body.reason.length > 500)) return res.status(400).json({ error: 'A rejection reason is required (up to 500 characters).' });
    if (req.body.status === 'Resolved' && (typeof req.body.resolutionSummary !== 'string' || !req.body.resolutionSummary.trim() || req.body.resolutionSummary.length > 1000)) return res.status(400).json({ error: 'A resolution summary is required (up to 1000 characters).' });
    await db.$transaction(async tx => {
      await tx.report.update({
        where: { id: report.id }, data: {
          status: req.body.status,
          ...(req.body.status === 'Verified' ? { verifierId: req.user.id, verifiedAt: new Date() } : {}),
          ...(req.body.status === 'Rejected' ? { rejectionReason: req.body.reason.trim() } : {}),
          ...(req.body.status === 'Resolved' ? { resolutionSummary: req.body.resolutionSummary.trim() } : {})
        }
      });
      await tx.review.create({ data: { reportId: report.id, reviewerId: req.user.id, status: req.body.status } });
      await tx.incidentEvent.create({
        data: {
          reportId: report.id, actorId: req.user.id, type: `STATUS_${req.body.status.toUpperCase()}`,
          previousStatus: report.status, newStatus: req.body.status, note: req.body.reason?.trim() || req.body.resolutionSummary?.trim() || null
        }
      });
      const subscriptions = await tx.subscription.findMany({ where: { areaId: report.areaId } });
      const recipients = new Set([report.reporterId, ...subscriptions.map(item => item.userId)]);
      await tx.notification.createMany({
        data: [...recipients].map(userId => ({
          userId, reportId: report.id,
          message: `Report review updated: ${report.hazard} — ${req.body.status}. This status is not an emergency warning.`
        }))
      });
    });
    res.json({ success: true });
  });
  app.post('/api/reports/:id/assignments', adminOnly, async (req, res) => {
    const report = await db.report.findFirst({ where: { id: req.params.id, areaId: { in: await assignedAreas(req.user) } } });
    if (!report) return res.status(404).json({ error: 'Incident not found in your assigned areas.' });
    if (report.status !== 'Verified') return res.status(409).json({ error: 'Only verified incidents can be assigned.' });
    if (typeof req.body?.teamId !== 'string' || !req.body.teamId) return res.status(400).json({ error: 'Choose an active response team.' });
    const team = await db.responseTeam.findFirst({ where: { id: req.body.teamId, active: true, organization: { active: true } }, include: { organization: true, members: true } });
    if (!team) return res.status(400).json({ error: 'Choose an active response team.' });
    try {
      const result = await db.$transaction(async tx => {
        const assignment = await tx.incidentAssignment.create({ data: { reportId: report.id, teamId: team.id, assignedById: req.user.id } });
        await tx.incidentEvent.create({ data: { reportId: report.id, actorId: req.user.id, type: 'TEAM_ASSIGNED', note: `${team.organization.name} / ${team.name}` } });
        if (team.members.length) await tx.notification.createMany({ data: team.members.map(member => ({ userId: member.userId, reportId: report.id, message: `A verified incident has been assigned to ${team.organization.name} / ${team.name}. Acknowledgement is required before response progress is recorded.` })) });
        return assignment;
      });
      res.status(201).json(result);
    } catch (error) { if (error.code === 'P2002') return res.status(409).json({ error: 'This team is already assigned to the incident.' }); throw error; }
  });
  app.post('/api/assignments/:id/acknowledge', async (req, res) => {
    const assignment = await db.incidentAssignment.findUnique({ where: { id: req.params.id }, include: { team: { include: { members: true } }, report: { select: { areaId: true } } } });
    if (!assignment?.active) return res.status(404).json({ error: 'Active assignment not found.' });
    if (req.user.role !== 'ADMIN' && !assignment.team.members.some(member => member.userId === req.user.id)) return res.status(403).json({ error: 'Only an assigned team member can acknowledge this assignment.' });
    if (req.user.role === 'ADMIN' && !(await assignedAreas(req.user)).includes(assignment.report.areaId)) return res.status(403).json({ error: 'This incident is outside your assigned areas.' });
    if (assignment.acknowledgedAt) return res.status(409).json({ error: 'Assignment has already been acknowledged.' });
    await db.$transaction(async tx => {
      await tx.incidentAssignment.update({ where: { id: assignment.id }, data: { acknowledgedAt: new Date() } });
      await tx.incidentEvent.create({ data: { reportId: assignment.reportId, actorId: req.user.id, type: 'ASSIGNMENT_ACKNOWLEDGED', note: 'Assignment acknowledged in the application.' } });
    });
    res.json({ success: true });
  });
  app.post('/api/assignments/:id/responding', async (req, res) => {
    const assignment = await db.incidentAssignment.findUnique({ where: { id: req.params.id }, include: { team: { include: { members: true } }, report: true } });
    if (!assignment?.active || !assignment.acknowledgedAt) return res.status(409).json({ error: 'An active, acknowledged assignment is required.' });
    if (req.user.role !== 'ADMIN' && !assignment.team.members.some(member => member.userId === req.user.id)) return res.status(403).json({ error: 'Only an assigned team member can update response progress.' });
    if (req.user.role === 'ADMIN' && !(await assignedAreas(req.user)).includes(assignment.report.areaId)) return res.status(403).json({ error: 'This incident is outside your assigned areas.' });
    if (assignment.report.status !== 'Verified') return res.status(409).json({ error: 'Only a verified incident can move to Responding.' });
    await db.$transaction(async tx => {
      await tx.report.update({ where: { id: assignment.reportId }, data: { status: 'Responding' } });
      await tx.incidentEvent.create({ data: { reportId: assignment.reportId, actorId: req.user.id, type: 'STATUS_RESPONDING', previousStatus: 'Verified', newStatus: 'Responding', note: req.body?.note?.slice(0, 500) || 'Response progress recorded in the application.' } });
    });
    res.json({ success: true });
  });
  app.post('/api/reports/:id/retry', adminOnly, async (req, res) => {
    const report = await db.report.findFirst({ where: { id: req.params.id, areaId: { in: await assignedAreas(req.user) } } });
    if (!report) return res.status(404).json({ error: 'Report not found in your assigned areas.' });
    const result = await db.analysisJob.updateMany({
      where: { reportId: report.id, status: 'Failed' },
      data: { status: 'Pending', attempts: 0, availableAt: new Date(), error: null, lockedAt: null }
    });
    if (!result.count) return res.status(409).json({ error: 'Only failed analyses can be retried.' });
    res.json({ success: true });
  });
  // AI photo relevance check (admin/owner only). Uses the existing AnalysisJob result if available.
  // The current Ollama model (llama3.2) is text-only; this endpoint returns the text-based assessment
  // status and notes the image was not analyzed directly by the AI.
  app.get('/api/reports/:id/photo-check', async (req, res) => {
    const report = await db.report.findUnique({ where: { id: req.params.id }, include: { job: true } });
    if (!report) return res.status(404).json({ error: 'Report not found.' });
    const isOwner = report.reporterId === req.user.id;
    const isAdmin = req.user.role === 'ADMIN' && (await assignedAreas(req.user)).includes(report.areaId);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Access denied.' });
    const job = report.job;
    if (!job) return res.json({ status: 'unavailable', label: 'AI check unavailable', explanation: 'No analysis job found for this report.' });
    const statusMap = {
      Pending: { label: 'Pending AI check', explanation: 'The automated context analysis is queued and has not completed yet.' },
      Processing: { label: 'Pending AI check', explanation: 'The automated context analysis is currently running.' },
      Completed: {
        label: job.result ? 'Likely relevant' : 'Inconclusive', explanation: job.result
          ? `Context analysis completed. Note: the current AI model is text-only and assessed the report description and weather context — it did not inspect the photo directly. ${job.result.disclaimer || ''}`
          : 'Analysis completed but returned no result.'
      },
      Failed: { label: 'AI check unavailable', explanation: `Analysis could not be completed after multiple attempts. Last error: ${job.error || 'Unknown error'}` },
    };
    const mapped = statusMap[job.status] || { label: 'AI check unavailable', explanation: 'Unknown status.' };
    res.json({ status: job.status, ...mapped, analysisJobId: job.id, completedAt: job.completedAt, modelNote: 'llama3.2 is a text-only model. Photo content was not analyzed by AI.' });
  });
  app.use('/api', (req, res) => res.status(404).json({ error: 'Endpoint not found.' }));
  app.use(express.static(fileURLToPath(new URL('../dist/', import.meta.url))));
  app.use((error, req, res, next) => {
    console.error(error.message);
    if (res.headersSent) return next(error);
    res.status(error.type === 'entity.too.large' ? 413 : error.type === 'entity.parse.failed' ? 400 : 500)
      .json({ error: error.type === 'entity.too.large' ? 'Photo is too large.' : error.type === 'entity.parse.failed' ? 'Invalid request.' : 'The request could not be completed. Please try again.' });
  });
  return app;
}

