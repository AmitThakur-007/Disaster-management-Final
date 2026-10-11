import { randomUUID } from 'node:crypto';
import { hashPassword } from './auth.js';

// In-memory data store for AI Studio runtime
class MemoryStore {
  constructor() {
    this.users = new Map();
    this.sessions = new Map();
    this.areas = new Map();
    this.adminAreas = new Map();
    this.subscriptions = new Map();
    this.reports = new Map();
    this.reviews = new Map();
    this.notifications = new Map();
    this.analysisJobs = new Map();
    this.responseOrganizations = new Map();
    this.responseTeams = new Map();
    this.teamMembers = new Map();
    this.incidentAssignments = new Map();
    this.incidentEvents = new Map();
    this.seeded = false;
  }

  async initSeed() {
    if (this.seeded) return;
    this.seeded = true;

    // Seed Areas
    const initialAreas = [
      { id: 'ktm-28', name: 'Kathmandu Metropolitan City — Ward 28', latitude: 27.705, longitude: 85.322 },
      { id: 'ktm-29', name: 'Kathmandu Metropolitan City — Ward 29', latitude: 27.714, longitude: 85.325 },
      { id: 'ktm-01', name: 'Kathmandu Metropolitan City — Ward 1 (Naxal)', latitude: 27.717, longitude: 85.329 },
      { id: 'ktm-03', name: 'Kathmandu Metropolitan City — Ward 3 (Maharajgunj)', latitude: 27.736, longitude: 85.330 },
      { id: 'lal-01', name: 'Lalitpur Metropolitan City — Ward 1 (Kupondole)', latitude: 27.687, longitude: 85.317 },
    ];
    for (const a of initialAreas) {
      this.areas.set(a.id, { ...a });
    }

    // Seed Default Admin Accounts (one unique account per email, all assigned to every ward)
    const adminPassword = process.env.ADMIN_PASSWORD && process.env.ADMIN_PASSWORD.length >= 12
      ? process.env.ADMIN_PASSWORD : 'Administrator123!';
    const defaultAdminHash = await hashPassword(adminPassword);
    const adminEmails = Array.from(new Set([
      (process.env.ADMIN_EMAIL || '').trim().toLowerCase(),
      'admin@disasterwatch.np',
      'admin@disaster-watch.local',
      'admin@example.com'
    ].filter(Boolean)));

    const adminIds = [];
    adminEmails.forEach((email, index) => {
      const id = index === 0 ? 'admin-default-uuid' : `admin-default-uuid-${index}`;
      adminIds.push(id);
      this.users.set(id, {
        id,
        name: 'Area Administrator',
        email,
        passwordHash: defaultAdminHash,
        role: 'ADMIN',
        createdAt: new Date(),
      });
    });
    const adminId = adminIds[0];

    // Assign every admin to all areas
    for (const id of adminIds) {
      for (const a of initialAreas) {
        this.adminAreas.set(`${id}_${a.id}`, { userId: id, areaId: a.id });
      }
    }

    // Seed Response Org & Team
    const orgId = 'org-redcross-nepal';
    this.responseOrganizations.set(orgId, {
      id: orgId,
      name: 'Nepal Red Cross Society',
      type: 'Disaster Relief & Search/Rescue',
      jurisdiction: 'Kathmandu Valley',
      active: true,
      createdById: adminId,
      createdAt: new Date(),
    });

    const teamId = 'team-ktm-quick-response';
    this.responseTeams.set(teamId, {
      id: teamId,
      organizationId: orgId,
      name: 'Kathmandu Quick Response Unit 1',
      active: true,
    });

    // Seed a responder account
    const responderEmail = 'responder@disasterwatch.np';
    const responderId = 'responder-default-uuid';
    this.users.set(responderId, {
      id: responderId,
      name: 'Bikash Shrestha (Lead Responder)',
      email: responderEmail,
      passwordHash: await hashPassword('ResponderPass123!'),
      role: 'RESPONDER',
      createdAt: new Date(),
    });
    this.teamMembers.set(`${teamId}_${responderId}`, { teamId, userId: responderId });

    // Seed sample reports
    const report1Id = 'sample-report-flood-28';
    const report1 = {
      id: report1Id,
      hazard: 'Rising water',
      description: 'Dhobi Khola water level rising rapidly near Putalisadak bridge following heavy monsoon rain. Storm drains backing up onto low-lying pedestrian walkways.',
      photoPath: 'sample-flood.jpg',
      areaId: 'ktm-28',
      reporterId: adminId,
      status: 'Verified',
      severity: 'High',
      locality: 'Putalisadak Bridge / Dhobi Khola corridor',
      district: 'Kathmandu',
      municipality: 'Kathmandu Metropolitan City',
      latitude: 27.705,
      longitude: 85.322,
      incidentAt: new Date(Date.now() - 3600000 * 2),
      verifiedAt: new Date(Date.now() - 3600000),
      verifierId: adminId,
      rejectionReason: null,
      resolutionSummary: null,
      createdAt: new Date(Date.now() - 3600000 * 3),
    };
    this.reports.set(report1Id, report1);

    this.analysisJobs.set('job-sample-1', {
      id: 'job-sample-1',
      reportId: report1Id,
      status: 'Completed',
      attempts: 1,
      availableAt: new Date(),
      lockedAt: null,
      error: null,
      result: {
        summary: 'Elevated water runoff observed along Dhobi Khola drainage zone consistent with recent heavy rainfall.',
        weatherContext: 'Recent monsoon precipitation totals around Putalisadak catchment elevated upstream discharge.',
        uncertainties: ['Exact embankment crest clearance is unmeasured', 'Subsurface drainage blockages undetermined'],
        reviewQuestions: ['Inspect downstream weir clearance', 'Verify if roadway ingress is worsening'],
        model: 'contextual-assistant',
      },
      weather: {
        source: 'Open-Meteo',
        retrievedAt: new Date().toISOString(),
        note: 'Monsoon forecast active for Kathmandu valley',
      },
      model: 'contextual-assistant',
      completedAt: new Date(),
    });

    this.incidentEvents.set('evt-1', {
      id: 'evt-1',
      reportId: report1Id,
      actorId: adminId,
      type: 'REPORT_SUBMITTED',
      newStatus: 'Reported',
      createdAt: new Date(Date.now() - 3600000 * 3),
    });
    this.incidentEvents.set('evt-2', {
      id: 'evt-2',
      reportId: report1Id,
      actorId: adminId,
      type: 'STATUS_VERIFIED',
      previousStatus: 'Reported',
      newStatus: 'Verified',
      note: 'Verified with local ward wardens.',
      createdAt: new Date(Date.now() - 3600000),
    });

    // Assign team to report 1
    const assign1Id = 'assign-sample-1';
    this.incidentAssignments.set(assign1Id, {
      id: assign1Id,
      reportId: report1Id,
      teamId: teamId,
      assignedById: adminId,
      assignedAt: new Date(Date.now() - 1800000),
      acknowledgedAt: new Date(Date.now() - 900000),
      progressNote: 'Team en route with submersible pumps and perimeter barrier equipment.',
      active: true,
    });

    const report2Id = 'sample-report-landslide-29';
    this.reports.set(report2Id, {
      id: report2Id,
      hazard: 'Land crack',
      description: 'Minor earth displacement and widening fissure observed along roadside embankment near Samakhusi slope.',
      photoPath: 'sample-crack.jpg',
      areaId: 'ktm-29',
      reporterId: adminId,
      status: 'Reported',
      severity: 'Medium',
      locality: 'Samakhusi corridor',
      district: 'Kathmandu',
      municipality: 'Kathmandu Metropolitan City',
      latitude: 27.714,
      longitude: 85.325,
      incidentAt: new Date(Date.now() - 3600000 * 5),
      verifiedAt: null,
      verifierId: null,
      rejectionReason: null,
      resolutionSummary: null,
      createdAt: new Date(Date.now() - 3600000 * 5),
    });
    this.analysisJobs.set('job-sample-2', {
      id: 'job-sample-2',
      reportId: report2Id,
      status: 'Pending',
      attempts: 0,
      availableAt: new Date(),
      lockedAt: null,
      error: null,
      result: null,
      weather: null,
      model: null,
      completedAt: null,
    });
    this.incidentEvents.set('evt-3', {
      id: 'evt-3',
      reportId: report2Id,
      actorId: adminId,
      type: 'REPORT_SUBMITTED',
      newStatus: 'Reported',
      createdAt: new Date(Date.now() - 3600000 * 5),
    });
  }
}

const store = new MemoryStore();
await store.initSeed();

function filterWhere(item, where) {
  if (!where) return true;
  for (const [key, val] of Object.entries(where)) {
    if (val === undefined) continue;
    if (val !== null && typeof val === 'object') {
      if ('in' in val && Array.isArray(val.in)) {
        if (!val.in.includes(item[key])) return false;
      } else if ('lt' in val) {
        if (!(item[key] < val.lt)) return false;
      } else if ('lte' in val) {
        if (!(item[key] <= val.lte)) return false;
      } else if ('gt' in val) {
        if (!(item[key] > val.gt)) return false;
      } else if ('gte' in val) {
        if (!(item[key] >= val.gte)) return false;
      }
    } else {
      if (item[key] !== val) return false;
    }
  }
  return true;
}

function sortList(list, orderBy) {
  if (!orderBy) return list;
  const entries = Object.entries(orderBy);
  if (!entries.length) return list;
  const [field, dir] = entries[0];
  const order = dir === 'desc' ? -1 : 1;
  return [...list].sort((a, b) => {
    const valA = a[field];
    const valB = b[field];
    if (valA instanceof Date && valB instanceof Date) {
      return (valA.getTime() - valB.getTime()) * order;
    }
    if (valA < valB) return -1 * order;
    if (valA > valB) return 1 * order;
    return 0;
  });
}

function buildReportPresentation(report, include) {
  if (!include) return { ...report };
  const res = { ...report };
  if (include.area) {
    res.area = store.areas.get(report.areaId) || null;
  }
  if (include.job) {
    res.job = Array.from(store.analysisJobs.values()).find(j => j.reportId === report.id) || null;
  }
  if (include.events) {
    let evts = Array.from(store.incidentEvents.values()).filter(e => e.reportId === report.id);
    if (include.events.orderBy) evts = sortList(evts, include.events.orderBy);
    res.events = evts.map(e => {
      const actor = store.users.get(e.actorId);
      return {
        ...e,
        actor: actor ? { id: actor.id, name: actor.name, role: actor.role } : null,
      };
    });
  }
  if (include.incidentAssignments) {
    let assigns = Array.from(store.incidentAssignments.values()).filter(a => a.reportId === report.id);
    if (include.incidentAssignments.where?.active !== undefined) {
      assigns = assigns.filter(a => a.active === include.incidentAssignments.where.active);
    }
    res.incidentAssignments = assigns.map(a => {
      const team = store.responseTeams.get(a.teamId);
      const org = team ? store.responseOrganizations.get(team.organizationId) : null;
      return {
        ...a,
        team: team ? { ...team, organization: org } : null,
      };
    });
  }
  return res;
}

export const prisma = {
  $connect: async () => {},
  $disconnect: async () => {},
  $queryRaw: async (strings, ...values) => {
    const query = Array.isArray(strings) ? strings.join('?') : String(strings);
    if (query.includes('SELECT 1')) {
      return [{ 1: 1 }];
    }
    // Claim next AnalysisJob
    if (query.includes('UPDATE "AnalysisJob"') || query.includes('AnalysisJob')) {
      const now = new Date();
      const pendingJobs = Array.from(store.analysisJobs.values())
        .filter(j => j.status === 'Pending' && (!j.availableAt || j.availableAt <= now))
        .sort((a, b) => (a.availableAt || 0) - (b.availableAt || 0));
      if (!pendingJobs.length) return [];
      const job = pendingJobs[0];
      job.status = 'Processing';
      job.lockedAt = new Date();
      job.attempts = (job.attempts || 0) + 1;
      return [{ id: job.id }];
    }
    return [];
  },
  $transaction: async (fn) => {
    if (typeof fn === 'function') {
      return await fn(prisma);
    }
    if (Array.isArray(fn)) {
      return await Promise.all(fn);
    }
    return fn;
  },

  user: {
    findUnique: async ({ where }) => {
      if (where.id) return store.users.get(where.id) || null;
      if (where.email) {
        const norm = where.email.trim().toLowerCase();
        for (const u of store.users.values()) {
          if (u.email.toLowerCase() === norm) return { ...u };
        }
      }
      return null;
    },
    findMany: async ({ where, orderBy, select }) => {
      let list = Array.from(store.users.values()).filter(u => filterWhere(u, where));
      if (orderBy) list = sortList(list, orderBy);
      if (select) {
        list = list.map(u => {
          const res = {};
          for (const k of Object.keys(select)) if (select[k]) res[k] = u[k];
          return res;
        });
      }
      return list;
    },
    create: async ({ data }) => {
      const id = data.id || randomUUID();
      const user = { id, createdAt: new Date(), role: 'RESIDENT', ...data };
      store.users.set(id, user);
      return { ...user };
    },
    update: async ({ where, data }) => {
      const u = store.users.get(where.id);
      if (!u) throw new Error('User not found');
      Object.assign(u, data);
      return { ...u };
    },
    deleteMany: async ({ where } = {}) => {
      let count = 0;
      for (const [id, u] of store.users.entries()) {
        if (filterWhere(u, where)) {
          store.users.delete(id);
          count++;
        }
      }
      return { count };
    },
    upsert: async ({ where, create, update }) => {
      let u = null;
      if (where.email) {
        for (const user of store.users.values()) {
          if (user.email.toLowerCase() === where.email.toLowerCase()) { u = user; break; }
        }
      } else if (where.id) {
        u = store.users.get(where.id);
      }
      if (u) {
        Object.assign(u, update);
        return { ...u };
      }
      return await prisma.user.create({ data: create });
    },
  },

  session: {
    create: async ({ data }) => {
      store.sessions.set(data.id, { ...data });
      return { ...data };
    },
    findUnique: async ({ where, include }) => {
      const s = store.sessions.get(where.id);
      if (!s) return null;
      const res = { ...s };
      if (include?.user) {
        res.user = store.users.get(s.userId) || null;
      }
      return res;
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const [id, s] of store.sessions.entries()) {
        if (filterWhere(s, where)) {
          store.sessions.delete(id);
          count++;
        }
      }
      return { count };
    },
  },

  area: {
    findMany: async ({ orderBy } = {}) => {
      let list = Array.from(store.areas.values());
      if (orderBy) list = sortList(list, orderBy);
      return list.map(a => ({ ...a }));
    },
    findUnique: async ({ where }) => {
      const a = store.areas.get(where.id);
      return a ? { ...a } : null;
    },
    count: async ({ where } = {}) => {
      return Array.from(store.areas.values()).filter(a => filterWhere(a, where)).length;
    },
    upsert: async ({ where, create, update }) => {
      const a = store.areas.get(where.id);
      if (a) {
        Object.assign(a, update);
        return { ...a };
      }
      store.areas.set(where.id, { id: where.id, ...create });
      return { ...store.areas.get(where.id) };
    },
  },

  subscription: {
    findMany: async ({ where } = {}) => {
      return Array.from(store.subscriptions.values()).filter(s => filterWhere(s, where)).map(s => ({ ...s }));
    },
    deleteMany: async ({ where }) => {
      let count = 0;
      for (const [key, s] of store.subscriptions.entries()) {
        if (filterWhere(s, where)) {
          store.subscriptions.delete(key);
          count++;
        }
      }
      return { count };
    },
    createMany: async ({ data }) => {
      let count = 0;
      for (const d of data) {
        store.subscriptions.set(`${d.userId}_${d.areaId}`, { ...d });
        count++;
      }
      return { count };
    },
  },

  adminArea: {
    findMany: async ({ where } = {}) => {
      return Array.from(store.adminAreas.values()).filter(a => filterWhere(a, where)).map(a => ({ ...a }));
    },
    upsert: async ({ where, create, update }) => {
      const key = `${where.userId_areaId?.userId || create.userId}_${where.userId_areaId?.areaId || create.areaId}`;
      const existing = store.adminAreas.get(key);
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      store.adminAreas.set(key, { ...create });
      return { ...create };
    },
  },

  report: {
    count: async ({ where } = {}) => {
      return Array.from(store.reports.values()).filter(r => filterWhere(r, where)).length;
    },
    findMany: async ({ where, orderBy, take, select, include }) => {
      let list = Array.from(store.reports.values()).filter(r => filterWhere(r, where));
      if (orderBy) list = sortList(list, orderBy);
      if (take && list.length > take) list = list.slice(0, take);
      if (include) {
        return list.map(r => buildReportPresentation(r, include));
      }
      if (select) {
        return list.map(r => {
          const res = {};
          for (const k of Object.keys(select)) {
            if (k === 'area' && select.area) {
              const a = store.areas.get(r.areaId);
              res.area = a ? { id: a.id, name: a.name, latitude: a.latitude, longitude: a.longitude } : null;
            } else if (select[k]) {
              res[k] = r[k];
            }
          }
          return res;
        });
      }
      return list.map(r => ({ ...r }));
    },
    findUnique: async ({ where, include }) => {
      const r = store.reports.get(where.id);
      if (!r) return null;
      return buildReportPresentation(r, include);
    },
    findFirst: async ({ where, include }) => {
      for (const r of store.reports.values()) {
        if (filterWhere(r, where)) {
          return buildReportPresentation(r, include);
        }
      }
      return null;
    },
    create: async ({ data }) => {
      const id = data.id || randomUUID();
      const { job, ...reportData } = data;
      const report = {
        id,
        createdAt: new Date(),
        status: 'Reported',
        severity: 'Medium',
        ...reportData,
      };
      store.reports.set(id, report);
      if (job?.create) {
        const jobId = randomUUID();
        store.analysisJobs.set(jobId, {
          id: jobId,
          reportId: id,
          status: 'Pending',
          attempts: 0,
          availableAt: new Date(),
          lockedAt: null,
          error: null,
          result: null,
          weather: null,
          model: null,
          completedAt: null,
        });
      }
      return { ...report };
    },
    update: async ({ where, data }) => {
      const r = store.reports.get(where.id);
      if (!r) throw new Error('Report not found');
      Object.assign(r, data);
      return { ...r };
    },
    deleteMany: async ({ where } = {}) => {
      let count = 0;
      for (const [id, r] of store.reports.entries()) {
        if (filterWhere(r, where)) {
          store.reports.delete(id);
          count++;
        }
      }
      return { count };
    },
  },

  review: {
    create: async ({ data }) => {
      const id = data.id || randomUUID();
      const rev = { id, createdAt: new Date(), ...data };
      store.reviews.set(id, rev);
      return { ...rev };
    },
    deleteMany: async ({ where } = {}) => {
      let count = 0;
      for (const [id, r] of store.reviews.entries()) {
        if (filterWhere(r, where)) {
          store.reviews.delete(id);
          count++;
        }
      }
      return { count };
    },
  },

  notification: {
    findMany: async ({ where, orderBy, take }) => {
      let list = Array.from(store.notifications.values()).filter(n => filterWhere(n, where));
      if (orderBy) list = sortList(list, orderBy);
      if (take && list.length > take) list = list.slice(0, take);
      return list.map(n => ({ ...n }));
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const n of store.notifications.values()) {
        if (filterWhere(n, where)) {
          Object.assign(n, data);
          count++;
        }
      }
      return { count };
    },
    createMany: async ({ data }) => {
      let count = 0;
      for (const d of data) {
        const id = randomUUID();
        store.notifications.set(id, { id, createdAt: new Date(), readAt: null, ...d });
        count++;
      }
      return { count };
    },
  },

  analysisJob: {
    findUnique: async ({ where, include }) => {
      const j = store.analysisJobs.get(where.id);
      if (!j) return null;
      const res = { ...j };
      if (include?.report) {
        const r = store.reports.get(j.reportId);
        if (r) {
          res.report = { ...r };
          if (include.report.include?.area) {
            res.report.area = store.areas.get(r.areaId) || null;
          }
        }
      }
      return res;
    },
    update: async ({ where, data }) => {
      const j = store.analysisJobs.get(where.id);
      if (!j) throw new Error('AnalysisJob not found');
      Object.assign(j, data);
      return { ...j };
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const j of store.analysisJobs.values()) {
        if (filterWhere(j, where)) {
          Object.assign(j, data);
          count++;
        }
      }
      return { count };
    },
  },

  responseOrganization: {
    count: async ({ where } = {}) => {
      return Array.from(store.responseOrganizations.values()).filter(o => filterWhere(o, where)).length;
    },
    findMany: async ({ include, orderBy } = {}) => {
      let list = Array.from(store.responseOrganizations.values());
      if (orderBy) list = sortList(list, orderBy);
      if (include?.teams) {
        return list.map(org => {
          let teams = Array.from(store.responseTeams.values()).filter(t => t.organizationId === org.id);
          if (include.teams.include?.members) {
            teams = teams.map(t => {
              let members = Array.from(store.teamMembers.values()).filter(m => m.teamId === t.id);
              return {
                ...t,
                members: members.map(m => {
                  const u = store.users.get(m.userId);
                  return { ...m, user: u ? { id: u.id, name: u.name, email: u.email } : null };
                }),
              };
            });
          }
          return { ...org, teams };
        });
      }
      return list.map(o => ({ ...o }));
    },
    findUnique: async ({ where }) => {
      const o = store.responseOrganizations.get(where.id);
      return o ? { ...o } : null;
    },
    create: async ({ data }) => {
      const id = data.id || randomUUID();
      const org = { id, createdAt: new Date(), active: true, ...data };
      store.responseOrganizations.set(id, org);
      return { ...org };
    },
  },

  responseTeam: {
    count: async ({ where } = {}) => {
      return Array.from(store.responseTeams.values()).filter(t => filterWhere(t, where)).length;
    },
    findMany: async ({ where, include, orderBy } = {}) => {
      let list = Array.from(store.responseTeams.values()).filter(t => {
        if (where?.active !== undefined && t.active !== where.active) return false;
        if (where?.organization?.active !== undefined) {
          const org = store.responseOrganizations.get(t.organizationId);
          if (org?.active !== where.organization.active) return false;
        }
        return true;
      });
      if (orderBy) list = sortList(list, orderBy);
      return list.map(t => {
        const res = { ...t };
        if (include?.organization) {
          res.organization = store.responseOrganizations.get(t.organizationId) || null;
        }
        if (include?.members) {
          const members = Array.from(store.teamMembers.values()).filter(m => m.teamId === t.id);
          res.members = members.map(m => {
            const u = store.users.get(m.userId);
            return { ...m, user: u ? { id: u.id, name: u.name, email: u.email } : null };
          });
        }
        return res;
      });
    },
    findFirst: async ({ where, include }) => {
      for (const t of store.responseTeams.values()) {
        if (where.id && t.id !== where.id) continue;
        if (where.active !== undefined && t.active !== where.active) continue;
        if (where.organization?.active !== undefined) {
          const org = store.responseOrganizations.get(t.organizationId);
          if (org?.active !== where.organization.active) continue;
        }
        const res = { ...t };
        if (include?.organization) {
          res.organization = store.responseOrganizations.get(t.organizationId) || null;
        }
        if (include?.members) {
          const members = Array.from(store.teamMembers.values()).filter(m => m.teamId === t.id);
          res.members = members.map(m => {
            const u = store.users.get(m.userId);
            return { ...m, user: u ? { id: u.id, name: u.name, email: u.email } : null };
          });
        }
        return res;
      }
      return null;
    },
    create: async ({ data }) => {
      const id = data.id || randomUUID();
      const team = { id, active: true, ...data };
      store.responseTeams.set(id, team);
      return { ...team };
    },
  },

  teamMember: {
    findMany: async ({ where } = {}) => {
      return Array.from(store.teamMembers.values()).filter(m => filterWhere(m, where)).map(m => ({ ...m }));
    },
    findFirst: async ({ where }) => {
      for (const m of store.teamMembers.values()) {
        if (where.userId && m.userId !== where.userId) continue;
        if (where.team?.assignments?.some) {
          const check = where.team.assignments.some;
          const hasAssign = Array.from(store.incidentAssignments.values()).some(a =>
            a.teamId === m.teamId && a.reportId === check.reportId && (check.active === undefined || a.active === check.active)
          );
          if (!hasAssign) continue;
        }
        return { ...m };
      }
      return null;
    },
    upsert: async ({ where, create, update }) => {
      const key = `${where.teamId_userId?.teamId || create.teamId}_${where.teamId_userId?.userId || create.userId}`;
      const existing = store.teamMembers.get(key);
      if (existing) {
        Object.assign(existing, update);
        return { ...existing };
      }
      store.teamMembers.set(key, { ...create });
      return { ...create };
    },
  },

  incidentAssignment: {
    findMany: async ({ where, include, orderBy } = {}) => {
      let list = Array.from(store.incidentAssignments.values()).filter(a => {
        if (where?.active !== undefined && a.active !== where.active) return false;
        if (where?.teamId?.in && !where.teamId.in.includes(a.teamId)) return false;
        return true;
      });
      if (orderBy) list = sortList(list, orderBy);
      return list.map(a => {
        const res = { ...a };
        if (include?.report) {
          const r = store.reports.get(a.reportId);
          res.report = r ? buildReportPresentation(r, include.report.include) : null;
        }
        if (include?.team) {
          const t = store.responseTeams.get(a.teamId);
          const org = t ? store.responseOrganizations.get(t.organizationId) : null;
          res.team = t ? { ...t, organization: org } : null;
        }
        return res;
      });
    },
    findUnique: async ({ where, include }) => {
      const a = store.incidentAssignments.get(where.id);
      if (!a) return null;
      const res = { ...a };
      if (include?.team) {
        const t = store.responseTeams.get(a.teamId);
        const members = t && include.team.include?.members ? Array.from(store.teamMembers.values()).filter(m => m.teamId === t.id) : [];
        res.team = t ? { ...t, members } : null;
      }
      if (include?.report) {
        const r = store.reports.get(a.reportId);
        res.report = r ? { ...r } : null;
      }
      return res;
    },
    create: async ({ data }) => {
      const id = data.id || randomUUID();
      const existing = Array.from(store.incidentAssignments.values()).find(a => a.reportId === data.reportId && a.teamId === data.teamId && a.active);
      if (existing) {
        const err = new Error('Unique constraint failed');
        err.code = 'P2002';
        throw err;
      }
      const assign = { id, assignedAt: new Date(), acknowledgedAt: null, active: true, ...data };
      store.incidentAssignments.set(id, assign);
      return { ...assign };
    },
    update: async ({ where, data }) => {
      const a = store.incidentAssignments.get(where.id);
      if (!a) throw new Error('Assignment not found');
      Object.assign(a, data);
      return { ...a };
    },
  },

  incidentEvent: {
    create: async ({ data }) => {
      const id = data.id || randomUUID();
      const evt = { id, createdAt: new Date(), ...data };
      store.incidentEvents.set(id, evt);
      return { ...evt };
    },
  },
};
