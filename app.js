const STORAGE_KEY = 'odak-workspace-v1';
const projectColors = ['color-0', 'color-1', 'color-2', 'color-3'];
const initialState = { projects: [], tasks: [], contacts: [] };
let state = loadState();
let activeView = 'overview';
let dialogMode = null;
let toastTimer;

function loadState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return structuredClone(initialState);
  const parsed = JSON.parse(saved);
  if (!parsed || !Array.isArray(parsed.projects) || !Array.isArray(parsed.tasks) || !Array.isArray(parsed.contacts)) {
    throw new Error('Kayıtlı çalışma alanı verisi beklenen biçimde değil.');
  }
  let migratedTasks = false;
  parsed.tasks = parsed.tasks.map((task) => {
    const migrated = { ...task };
    if (!migrated.ownerId && migrated.contactId) {
      migrated.ownerId = migrated.contactId || '';
      migratedTasks = true;
    } else if (!Object.prototype.hasOwnProperty.call(migrated, 'ownerId')) {
      migrated.ownerId = '';
      migratedTasks = true;
    }
    if (!Object.prototype.hasOwnProperty.call(migrated, 'recipientId')) {
      migrated.recipientId = '';
      migratedTasks = true;
    }
    if (Object.prototype.hasOwnProperty.call(migrated, 'contactId')) {
      delete migrated.contactId;
      migratedTasks = true;
    }
    return migrated;
  });
  if (migratedTasks) localStorage.setItem(STORAGE_KEY, JSON.stringify(parsed));
  return parsed;
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function escapeHTML(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

function formatDate(value, options = { day: 'numeric', month: 'short' }) {
  if (!value) return 'Tarih yok';
  return new Intl.DateTimeFormat('tr-TR', options).format(new Date(`${value}T12:00:00`));
}

function getProject(projectId) {
  return state.projects.find((project) => project.id === projectId);
}

function getContact(contactId) {
  return state.contacts.find((contact) => contact.id === contactId);
}

function taskPeople(task) {
  const owner = getContact(task.ownerId);
  const recipient = getContact(task.recipientId);
  return `<span class="task-people"><span>Sorumlu: ${escapeHTML(owner?.name || 'Atanmadı')}</span><span>İletilecek: ${escapeHTML(recipient?.name || 'Belirtilmedi')}</span></span>`;
}

function openTasks(projectId) {
  return state.tasks.filter((task) => task.projectId === projectId && task.status !== 'done');
}

function compareTaskDueDate(a, b) {
  if (!a.dueDate && !b.dueDate) return 0;
  if (!a.dueDate) return 1;
  if (!b.dueDate) return -1;
  return a.dueDate.localeCompare(b.dueDate);
}

function compareTaskUrgency(a, b) {
  const aDone = a.status === 'done';
  const bDone = b.status === 'done';
  if (aDone !== bDone) return aDone ? 1 : -1;
  return compareTaskDueDate(a, b);
}

function getDueDateClass(task) {
  if (!task.dueDate) return '';
  if (task.status === 'done') return 'completed';
  const [year, month, day] = task.dueDate.split('-').map(Number);
  const dueDay = Date.UTC(year, month - 1, day);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const daysUntilDue = Math.round((dueDay - today) / 86400000);
  if (daysUntilDue < 0) return 'overdue';
  if (daysUntilDue === 0) return 'due-today';
  if (daysUntilDue <= 2) return 'due-imminent';
  if (daysUntilDue <= 7) return 'due-soon';
  return '';
}

function getRecurrenceLabel(recurrence) {
  const labels = { daily: 'Günlük', weekly: 'Haftalık', monthly: 'Aylık', yearly: 'Yıllık' };
  return labels[recurrence] || '';
}

function getNextRecurrenceDate(value, recurrence, anchorDay) {
  const [year, month, day] = value.split('-').map(Number);
  let nextDate;
  if (recurrence === 'daily' || recurrence === 'weekly') {
    nextDate = new Date(Date.UTC(year, month - 1, day + (recurrence === 'daily' ? 1 : 7)));
  } else if (recurrence === 'monthly') {
    nextDate = new Date(Date.UTC(year, month, 1));
  } else if (recurrence === 'yearly') {
    nextDate = new Date(Date.UTC(year + 1, month - 1, 1));
  } else {
    return '';
  }

  const nextYear = nextDate.getUTCFullYear();
  const nextMonth = nextDate.getUTCMonth();
  const nextDay = recurrence === 'monthly' || recurrence === 'yearly'
    ? Math.min(anchorDay || day, new Date(Date.UTC(nextYear, nextMonth + 1, 0)).getUTCDate())
    : nextDate.getUTCDate();
  return `${nextYear}-${String(nextMonth + 1).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
}

function setView(view) {
  activeView = view;
  document.querySelectorAll('.page').forEach((page) => page.classList.add('hidden'));
  document.getElementById(`${view}-view`).classList.remove('hidden');
  document.querySelectorAll('.nav-link').forEach((link) => link.classList.toggle('active', link.dataset.view === view));
  const labels = { overview: 'Genel Bakış', projects: 'Projeler', actions: 'Aksiyonlar', contacts: 'Kontaklar', reports: 'Raporlar' };
  document.getElementById('breadcrumb-current').textContent = labels[view];
  render();
}

function render() {
  document.getElementById('project-count').textContent = state.projects.length;
  renderOverview();
  renderProjects();
  renderTasks();
  renderContacts();
  renderProjectFilter();
  renderReportProjectFilter();
  renderReport();
}

function renderOverview() {
  const open = state.tasks.filter((task) => task.status !== 'done');
  const today = new Date();
  const monday = new Date(today);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const dueThisWeek = open.filter((task) => {
    if (!task.dueDate) return false;
    const date = new Date(`${task.dueDate}T12:00:00`);
    return date >= monday && date <= sunday;
  }).length;
  document.getElementById('stat-projects').textContent = state.projects.length;
  document.getElementById('stat-open').textContent = open.length;
  document.getElementById('stat-week').textContent = dueThisWeek;

  const date = new Date();
  document.getElementById('today-label').textContent = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  document.getElementById('welcome-date').textContent = new Intl.DateTimeFormat('tr-TR', { weekday: 'long', day: 'numeric', month: 'long' }).format(date).toLocaleUpperCase('tr-TR');

  const upcoming = [...state.tasks].sort(compareTaskUrgency);
  document.getElementById('upcoming-list').innerHTML = upcoming.length
    ? upcoming.map((task) => {
      const project = getProject(task.projectId);
      const isDone = task.status === 'done';
      return `<div class="upcoming-item">
        <button class="task-check ${isDone ? 'checked' : ''}" data-action="toggle-task" data-id="${escapeHTML(task.id)}" aria-label="${isDone ? 'Yapılacak olarak işaretle' : 'Tamamlandı olarak işaretle'}">${isDone ? '✓' : ''}</button>
        <div class="upcoming-details"><p class="upcoming-title ${isDone ? 'done' : ''}">${escapeHTML(task.title)}</p>${task.notes ? `<p class="task-note-preview">${escapeHTML(task.notes)}</p>` : ''}<p class="upcoming-meta">${escapeHTML(project?.name || 'Projesiz')} · ${isDone ? 'Tamamlandı' : 'Açık'}${getRecurrenceLabel(task.recurrence) ? ` · ${getRecurrenceLabel(task.recurrence)}` : ''}</p>${taskPeople(task)}</div>
        <span class="due-date ${getDueDateClass(task)}">${task.dueDate ? formatDate(task.dueDate) : 'Tarih yok'}</span>
      </div>`;
    }).join('')
    : '<div class="empty-state"><strong>Aksiyon yok</strong>Yeni aksiyonlar burada listelenir.</div>';

  const projects = state.projects;
  document.getElementById('overview-projects').innerHTML = projects.length
    ? projects.map((project, index) => {
      const projectTasks = state.tasks.filter((task) => task.projectId === project.id).sort(compareTaskUrgency);
      const openCount = openTasks(project.id).length;
      return `<section class="overview-project">
        <div class="overview-project-head">
          <span class="project-color ${projectColors[index % projectColors.length]}"></span>
          <div class="overview-project-info"><p class="mini-project-name">${escapeHTML(project.name)}</p><p class="mini-project-meta">${openCount} açık aksiyon</p></div>
          <button class="project-add-action" data-action="overview-add-task" data-id="${escapeHTML(project.id)}" aria-label="${escapeHTML(project.name)} projesine aksiyon ekle">＋ Aksiyon ekle</button>
        </div>
        ${projectTasks.length ? `<div class="overview-project-actions">${projectTasks.map((task) => {
          const isDone = task.status === 'done';
          return `<div class="overview-project-action">
            <button class="task-check ${isDone ? 'checked' : ''}" data-action="toggle-task" data-id="${escapeHTML(task.id)}" aria-label="${isDone ? 'Yapılacak olarak işaretle' : 'Tamamlandı olarak işaretle'}">${isDone ? '✓' : ''}</button>
            <div class="overview-project-action-info"><span class="overview-project-action-title ${isDone ? 'done' : ''}">${escapeHTML(task.title)}</span>${getRecurrenceLabel(task.recurrence) ? `<span class="recurrence-badge">${getRecurrenceLabel(task.recurrence)}</span>` : ''}${task.notes ? `<span class="task-note-preview">${escapeHTML(task.notes)}</span>` : ''}${taskPeople(task)}</div>
            <span class="due-date ${getDueDateClass(task)}">${task.dueDate ? formatDate(task.dueDate) : 'Tarih yok'}</span>
          </div>`;
        }).join('')}</div>` : '<p class="overview-project-empty">Henüz aksiyon yok.</p>'}
      </section>`;
    }).join('')
    : '<div class="empty-state"><strong>Proje yok</strong>Yeni proje eklemek için + düğmesini kullan.</div>';
}

function renderProjects() {
  document.getElementById('projects-list').innerHTML = state.projects.length
    ? state.projects.map((project, index) => {
      const tasks = state.tasks.filter((task) => task.projectId === project.id);
      const done = tasks.filter((task) => task.status === 'done').length;
      const progress = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
      return `<article class="project-card">
        <div class="project-card-top"><span class="project-color ${projectColors[index % projectColors.length]}"></span>
          <div class="row-actions">
            <button class="small-icon-button" data-action="edit-project" data-id="${escapeHTML(project.id)}" aria-label="Projeyi düzenle">✎</button>
            <button class="small-icon-button" data-action="delete-project" data-id="${escapeHTML(project.id)}" aria-label="Projeyi sil">×</button>
          </div>
        </div>
        <h2 class="project-card-title">${escapeHTML(project.name)}</h2>
        <p class="project-description">${escapeHTML(project.description || 'Bu proje için henüz açıklama eklenmedi.')}</p>
        <div class="project-progress-label"><span>İlerleme</span><span>${progress}%</span></div>
        <div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div>
        <div class="project-footer"><span>${done}/${tasks.length} aksiyon tamamlandı</span><span>${formatDate(project.createdAt)}</span></div>
      </article>`;
    }).join('')
    : '<div class="empty-state"><strong>Proje yok</strong>Çalışma alanına proje ekleyebilirsin.</div>';
}

function renderProjectFilter() {
  const filter = document.getElementById('project-filter');
  const selected = filter.value;
  filter.innerHTML = '<option value="all">Tüm projeler</option>' + state.projects.map((project) => `<option value="${escapeHTML(project.id)}">${escapeHTML(project.name)}</option>`).join('');
  filter.value = state.projects.some((project) => project.id === selected) ? selected : 'all';
}

function renderTasks() {
  const query = document.getElementById('task-search').value.trim().toLocaleLowerCase('tr-TR');
  const statusFilter = document.getElementById('task-filter').value;
  const projectFilter = document.getElementById('project-filter').value;
  const tasks = [...state.tasks].filter((task) => {
    const matchesText = `${task.title} ${task.notes || ''}`.toLocaleLowerCase('tr-TR').includes(query);
    const matchesStatus = statusFilter === 'all' || (statusFilter === 'done' ? task.status === 'done' : task.status !== 'done');
    const matchesProject = projectFilter === 'all' || task.projectId === projectFilter;
    return matchesText && matchesStatus && matchesProject;
  }).sort(compareTaskUrgency);
  document.getElementById('tasks-list').innerHTML = tasks.length
    ? tasks.map((task) => {
      const project = getProject(task.projectId);
      const owner = getContact(task.ownerId);
      const recipient = getContact(task.recipientId);
      const isOverdue = task.status !== 'done' && task.dueDate && new Date(`${task.dueDate}T23:59:59`) < new Date();
      const status = task.status === 'done' ? 'Tamamlandı' : isOverdue ? 'Gecikti' : 'Açık';
      return `<div class="task-row">
        <button class="task-check ${task.status === 'done' ? 'checked' : ''}" data-action="toggle-task" data-id="${escapeHTML(task.id)}" aria-label="${task.status === 'done' ? 'Yapılacak olarak işaretle' : 'Tamamlandı olarak işaretle'}">${task.status === 'done' ? '✓' : ''}</button>
        <div><p class="task-row-title ${task.status === 'done' ? 'done' : ''}">${escapeHTML(task.title)}</p><p class="task-row-sub"><span class="due-date ${getDueDateClass(task)}">${task.dueDate ? formatDate(task.dueDate, { day: 'numeric', month: 'long', year: 'numeric' }) : 'Tarih belirlenmedi'}</span> · ${status}${getRecurrenceLabel(task.recurrence) ? `<span class="recurrence-badge">${getRecurrenceLabel(task.recurrence)}</span>` : ''}${task.notes ? `<span class="task-note-preview">${escapeHTML(task.notes)}</span>` : ''}${taskPeople(task)}</p></div>
        <span class="task-project-name">${escapeHTML(project?.name || 'Projesiz')}</span>
        <span class="priority ${task.priority}">${task.priority === 'high' ? 'Yüksek' : task.priority === 'medium' ? 'Orta' : 'Düşük'}</span>
        <span class="task-people"><span>Sorumlu: ${escapeHTML(owner?.name || 'Atanmadı')}</span><span>İletilecek: ${escapeHTML(recipient?.name || 'Belirtilmedi')}</span></span>
        <div class="row-actions">
          <button class="small-icon-button" data-action="edit-task" data-id="${escapeHTML(task.id)}" aria-label="Aksiyonu düzenle">✎</button>
          <button class="small-icon-button" data-action="delete-task" data-id="${escapeHTML(task.id)}" aria-label="Aksiyonu sil">×</button>
        </div>
      </div>`;
    }).join('')
    : '<div class="empty-state"><strong>Aksiyon bulunamadı</strong>Filtreleri kontrol et veya yeni aksiyon ekle.</div>';
}

function renderContacts() {
  document.getElementById('contacts-list').innerHTML = state.contacts.length
    ? state.contacts.map((contact) => `<article class="contact-card">
        <div class="contact-top"><span class="contact-avatar">${escapeHTML(contact.name.trim().charAt(0).toLocaleUpperCase('tr-TR') || '?')}</span><div><p class="contact-name">${escapeHTML(contact.name)}</p><p class="contact-role">${escapeHTML(contact.role || 'Kontak')}</p></div></div>
        <div class="contact-details">
          ${contact.email ? `<a href="mailto:${escapeHTML(contact.email)}">✉ &nbsp;${escapeHTML(contact.email)}</a>` : ''}
          ${contact.phone ? `<a href="tel:${escapeHTML(contact.phone)}">⌕ &nbsp;${escapeHTML(contact.phone)}</a>` : ''}
          ${contact.company ? `<span>▦ &nbsp;${escapeHTML(contact.company)}</span>` : ''}
        </div>
        ${contact.notes ? `<p class="contact-note">${escapeHTML(contact.notes)}</p>` : ''}
        <div class="contact-card-actions">
          <button class="small-icon-button" data-action="edit-contact" data-id="${escapeHTML(contact.id)}" aria-label="Kontak düzenle">✎</button>
          <button class="small-icon-button" data-action="delete-contact" data-id="${escapeHTML(contact.id)}" aria-label="Kontak sil">×</button>
        </div>
      </article>`).join('')
    : '<div class="empty-state"><strong>Kontak yok</strong>İlgili kişileri bu alana ekleyebilirsin.</div>';
}

function renderReportProjectFilter() {
  const filter = document.getElementById('report-project');
  const selected = filter.value;
  filter.innerHTML = '<option value="all">Tüm projeler</option>' + state.projects.map((project) => `<option value="${escapeHTML(project.id)}">${escapeHTML(project.name)}</option>`).join('');
  filter.value = state.projects.some((project) => project.id === selected) ? selected : 'all';
}

function renderReport() {
  const start = document.getElementById('report-start').value;
  const end = document.getElementById('report-end').value;
  const projectFilter = document.getElementById('report-project').value;
  const output = document.getElementById('report-output');
  if (!start || !end || start > end) {
    output.innerHTML = '<div class="report-message">Geçerli bir tarih aralığı seç. Başlangıç tarihi bitiş tarihinden sonra olamaz.</div>';
    return;
  }

  const projects = state.projects.filter((project) => projectFilter === 'all' || project.id === projectFilter);
  const isInProjectScope = (task) => projectFilter === 'all' || task.projectId === projectFilter;
  const reportTasks = state.tasks.filter((task) => isInProjectScope(task) && task.dueDate && task.dueDate >= start && task.dueDate <= end);
  const undatedCount = state.tasks.filter((task) => isInProjectScope(task) && !task.dueDate).length;
  const completed = reportTasks.filter((task) => task.status === 'done').length;
  const open = reportTasks.length - completed;
  const now = new Date();
  const today = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const overdue = reportTasks.filter((task) => task.status !== 'done' && task.dueDate < today).length;
  const contacts = [...new Set(reportTasks.flatMap((task) => [task.ownerId, task.recipientId]).filter(Boolean))]
    .map((contactId) => getContact(contactId))
    .filter(Boolean);

  const projectRows = projects.map((project) => {
    const tasks = reportTasks.filter((task) => task.projectId === project.id);
    const done = tasks.filter((task) => task.status === 'done').length;
    const percent = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
    return `<tr><td>${escapeHTML(project.name)}</td><td>${tasks.length}</td><td>${done}</td><td>${tasks.length - done}</td><td>${percent}%</td></tr>`;
  });
  if (projectFilter === 'all') {
    const unassignedTasks = reportTasks.filter((task) => !task.projectId || !getProject(task.projectId));
    if (unassignedTasks.length) {
      const done = unassignedTasks.filter((task) => task.status === 'done').length;
      const percent = Math.round((done / unassignedTasks.length) * 100);
      projectRows.push(`<tr><td>Projesiz</td><td>${unassignedTasks.length}</td><td>${done}</td><td>${unassignedTasks.length - done}</td><td>${percent}%</td></tr>`);
    }
  }

  const taskRows = [...reportTasks].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).map((task) => {
    const project = getProject(task.projectId);
    const owner = getContact(task.ownerId);
    const recipient = getContact(task.recipientId);
    const priority = task.priority === 'high' ? 'Yüksek' : task.priority === 'medium' ? 'Orta' : 'Düşük';
    const status = task.status === 'done' ? 'Tamamlandı' : task.dueDate < today ? 'Gecikti' : 'Açık';
    return `<tr><td>${formatDate(task.dueDate, { day: 'numeric', month: 'short', year: 'numeric' })}</td><td>${escapeHTML(project?.name || 'Projesiz')}</td><td>${escapeHTML(task.title)}</td><td>${escapeHTML(owner?.name || 'Atanmadı')}</td><td>${escapeHTML(recipient?.name || 'Belirtilmedi')}</td><td>${escapeHTML(getRecurrenceLabel(task.recurrence) || '—')}</td><td>${priority}</td><td>${status}</td></tr>`;
  }).join('');

  const contactRows = contacts.map((contact) => `<tr><td>${escapeHTML(contact.name)}</td><td>${escapeHTML(contact.company || '—')}</td><td>${escapeHTML(contact.email || '—')}</td><td>${escapeHTML(contact.phone || '—')}</td></tr>`).join('');
  const generated = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
  const projectName = projectFilter === 'all' ? 'Tüm projeler' : escapeHTML(getProject(projectFilter)?.name || 'Proje');

  output.innerHTML = `
    <header class="report-header">
      <div><p class="eyebrow">ÇALIŞMA ALANI RAPORU</p><h2>Aksiyon ve proje özeti</h2></div>
      <div class="report-meta"><span>Proje: ${projectName}</span><span>Dönem: ${formatDate(start, { day: 'numeric', month: 'long', year: 'numeric' })} – ${formatDate(end, { day: 'numeric', month: 'long', year: 'numeric' })}</span><span>Oluşturulma: ${generated}</span></div>
    </header>
    <div class="report-stats">
      <div><span>Toplam aksiyon</span><strong>${reportTasks.length}</strong></div>
      <div><span>Tamamlandı</span><strong>${completed}</strong></div>
      <div><span>Açık</span><strong>${open}</strong></div>
      <div><span>Geciken</span><strong>${overdue}</strong></div>
    </div>
    <section class="report-section"><h3>Proje özeti</h3>
      ${projects.length || projectRows.length ? `<div class="report-table-wrap"><table><thead><tr><th>Proje</th><th>Aksiyon</th><th>Tamamlandı</th><th>Açık</th><th>Tamamlanma</th></tr></thead><tbody>${projectRows.join('')}</tbody></table></div>` : '<p class="report-empty">Bu rapor filtresinde proje bulunmuyor.</p>'}
    </section>
    <section class="report-section"><h3>Aksiyonlar <span>Seçilen tarih aralığında son tarihi olan işler</span></h3>
      ${reportTasks.length ? `<div class="report-table-wrap"><table><thead><tr><th>Son tarih</th><th>Proje</th><th>Aksiyon</th><th>Sorumlu</th><th>İletilecek kişi</th><th>Tekrar</th><th>Öncelik</th><th>Durum</th></tr></thead><tbody>${taskRows}</tbody></table></div>` : '<p class="report-empty">Seçilen tarih aralığında son tarihi olan aksiyon yok.</p>'}
      ${undatedCount ? `<p class="report-note">Tarihi belirlenmemiş ${undatedCount} aksiyon tarih aralığına dahil edilmedi.</p>` : ''}
    </section>
    <section class="report-section"><h3>Aksiyon kişileri</h3>
      ${contactRows ? `<div class="report-table-wrap"><table><thead><tr><th>Ad soyad</th><th>Şirket</th><th>E-posta</th><th>Telefon</th></tr></thead><tbody>${contactRows}</tbody></table></div>` : '<p class="report-empty">Bu dönemdeki aksiyonlarda kişi ataması bulunmuyor.</p>'}
    </section>
    <footer class="report-footer">Bu rapor, çalışma alanındaki mevcut kayıtlardan oluşturulmuştur.</footer>`;
}

function field(name, label, type = 'text', value = '', options = {}) {
  const required = options.required ? 'required' : '';
  const placeholder = options.placeholder ? `placeholder="${escapeHTML(options.placeholder)}"` : '';
  if (type === 'textarea') return `<label class="field-group"><span class="field-label">${label}</span><textarea class="field-textarea" name="${name}" ${required} ${placeholder}>${escapeHTML(value)}</textarea></label>`;
  if (type === 'select') {
    const items = options.items || [];
    return `<label class="field-group"><span class="field-label">${label}</span><select class="field-select" name="${name}"><option value="">${escapeHTML(options.emptyLabel || 'Seçiniz')}</option>${items.map((item) => `<option value="${escapeHTML(item.value)}" ${item.value === value ? 'selected' : ''}>${escapeHTML(item.label)}</option>`).join('')}</select></label>`;
  }
  return `<label class="field-group"><span class="field-label">${label}</span><input class="field-input" type="${type}" name="${name}" value="${escapeHTML(value)}" ${required} ${placeholder}></label>`;
}

function showDialog(kind, record = {}) {
  dialogMode = { kind, id: record.id || null };
  const titles = { project: 'Proje', task: 'Aksiyon', contact: 'Kontak' };
  document.getElementById('dialog-title').textContent = `${record.id ? 'Düzenle' : 'Yeni'} ${titles[kind].toLocaleLowerCase('tr-TR')}`;
  document.getElementById('dialog-eyebrow').textContent = record.id ? 'KAYDI DÜZENLE' : 'YENİ KAYIT';
  let html = '';
  if (kind === 'project') {
    html = field('name', 'Proje adı', 'text', record.name || '', { required: true, placeholder: 'Örn. Web sitesi yenileme' })
      + field('description', 'Açıklama', 'textarea', record.description || '', { placeholder: 'Proje hakkında kısa bir not...' });
  } else if (kind === 'task') {
    html = field('title', 'Aksiyon adı', 'text', record.title || '', { required: true, placeholder: 'Örn. Teklif taslağını gönder' })
      + field('projectId', 'Proje', 'select', record.projectId || '', { emptyLabel: 'Proje seçmeden devam et', items: state.projects.map((item) => ({ value: item.id, label: item.name })) })
      + field('dueDate', 'Son tarih', 'date', record.dueDate || '', { required: Boolean(record.recurrence && record.recurrence !== 'none') })
      + field('recurrence', 'Tekrarlama', 'select', record.recurrence && record.recurrence !== 'none' ? record.recurrence : '', { emptyLabel: 'Tekrarlama yok', items: [{ value: 'daily', label: 'Günlük' }, { value: 'weekly', label: 'Haftalık' }, { value: 'monthly', label: 'Aylık' }, { value: 'yearly', label: 'Yıllık' }] })
      + '<p class="recurrence-help">Tamamlandığında sonraki tarihli aksiyon otomatik eklenir.</p>'
      + field('priority', 'Öncelik', 'select', record.priority || 'medium', { items: [{ value: 'low', label: 'Düşük' }, { value: 'medium', label: 'Orta' }, { value: 'high', label: 'Yüksek' }] })
      + field('ownerId', 'Sorumlu kişi', 'select', record.ownerId || '', { emptyLabel: 'Sorumlu seçmeden devam et', items: state.contacts.map((item) => ({ value: item.id, label: item.name })) })
      + field('recipientId', 'İletilecek kişi', 'select', record.recipientId || '', { emptyLabel: 'Alıcı seçmeden devam et', items: state.contacts.map((item) => ({ value: item.id, label: item.name })) })
      + field('notes', 'Notlar', 'textarea', record.notes || '', { placeholder: 'Bu aksiyonla ilgili detaylar...' });
  } else {
    html = field('name', 'Ad soyad', 'text', record.name || '', { required: true, placeholder: 'Örn. Deniz Yılmaz' })
      + field('role', 'Görev / rol', 'text', record.role || '', { placeholder: 'Örn. Proje yöneticisi' })
      + field('company', 'Şirket', 'text', record.company || '', { placeholder: 'Şirket adı' })
      + field('email', 'E-posta', 'email', record.email || '', { placeholder: 'ornek@sirket.com' })
      + field('phone', 'Telefon', 'tel', record.phone || '', { placeholder: '+90 5XX XXX XX XX' })
      + field('notes', 'Notlar', 'textarea', record.notes || '', { placeholder: 'Bu kişiyle ilgili notlar...' });
  }
  document.getElementById('dialog-fields').innerHTML = html;
  const recurrenceSelect = document.querySelector('#dialog-fields select[name="recurrence"]');
  if (recurrenceSelect) {
    const dueDateInput = document.querySelector('#dialog-fields input[name="dueDate"]');
    const dueDateLabel = dueDateInput.closest('.field-group').querySelector('.field-label');
    const updateDueDateRequirement = () => {
      dueDateInput.required = Boolean(recurrenceSelect.value);
      dueDateLabel.textContent = dueDateInput.required ? 'Son tarih *' : 'Son tarih';
    };
    recurrenceSelect.addEventListener('change', updateDueDateRequirement);
    updateDueDateRequirement();
  }
  document.getElementById('entry-dialog').showModal();
  document.querySelector('#dialog-fields input, #dialog-fields textarea')?.focus();
}

function closeDialog() {
  document.getElementById('entry-dialog').close();
  dialogMode = null;
}

function notify(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 2300);
}

function toggleTask(id) {
  const task = state.tasks.find((item) => item.id === id);
  if (!task) return;

  let createdNextOccurrence = false;
  if (task.status === 'done') {
    task.status = 'open';
  } else {
    task.status = 'done';
    const hasNextOccurrence = state.tasks.some((item) => item.recurrenceParentId === task.id);
    if (task.recurrence && task.recurrence !== 'none' && task.dueDate && !hasNextOccurrence) {
      const dueDate = getNextRecurrenceDate(task.dueDate, task.recurrence, task.recurrenceAnchorDay);
      if (dueDate) {
        state.tasks.push({
          ...task,
          id: crypto.randomUUID(),
          dueDate,
          status: 'open',
          recurrenceParentId: task.id
        });
        createdNextOccurrence = true;
      }
    }
  }

  saveState();
  render();
  notify(createdNextOccurrence ? 'Tamamlandı; sonraki tekrarı oluşturuldu.' : task.status === 'done' ? 'Aksiyon tamamlandı.' : 'Aksiyon yeniden açıldı.');
}

function removeRecord(kind, id) {
  if (kind === 'project') {
    const linkedTasks = state.tasks.filter((task) => task.projectId === id);
    const action = linkedTasks.length ? 'Bu projeyi ve ona bağlı aksiyonları silmek istediğine emin misin?' : 'Bu projeyi silmek istediğine emin misin?';
    if (!window.confirm(action)) return;
    state.projects = state.projects.filter((project) => project.id !== id);
    state.tasks = state.tasks.filter((task) => task.projectId !== id);
  } else if (kind === 'task') {
    if (!window.confirm('Bu aksiyonu silmek istediğine emin misin?')) return;
    state.tasks = state.tasks.filter((task) => task.id !== id);
  } else {
    if (!window.confirm('Bu kontağı silmek istediğine emin misin? Aksiyon kayıtları etkilenmez.')) return;
    state.contacts = state.contacts.filter((contact) => contact.id !== id);
    state.tasks = state.tasks.map((task) => ({
      ...task,
      ownerId: task.ownerId === id ? '' : task.ownerId,
      recipientId: task.recipientId === id ? '' : task.recipientId
    }));
  }
  saveState();
  render();
  notify('Kayıt silindi.');
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-view], [data-action]');
  if (!target) return;
  if (target.dataset.view) {
    setView(target.dataset.view);
    return;
  }
  const { action, id } = target.dataset;
  if (action === 'new-project') showDialog('project');
  if (action === 'new-task') showDialog('task');
  if (action === 'overview-add-task') showDialog('task', { projectId: id });
  if (action === 'new-contact') showDialog('contact');
  if (action === 'close-dialog') closeDialog();
  if (action === 'edit-project') showDialog('project', getProject(id));
  if (action === 'edit-task') showDialog('task', state.tasks.find((task) => task.id === id));
  if (action === 'edit-contact') showDialog('contact', getContact(id));
  if (action === 'delete-project') removeRecord('project', id);
  if (action === 'delete-task') removeRecord('task', id);
  if (action === 'delete-contact') removeRecord('contact', id);
  if (action === 'print-report') window.print();
  if (action === 'toggle-task') toggleTask(id);
});

document.getElementById('entry-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const formData = new FormData(event.currentTarget);
  const values = Object.fromEntries(formData.entries());
  const existing = dialogMode.id
    ? (dialogMode.kind === 'project' ? getProject(dialogMode.id) : dialogMode.kind === 'task' ? state.tasks.find((task) => task.id === dialogMode.id) : getContact(dialogMode.id))
    : null;
  if (dialogMode.kind === 'project') {
    const record = { ...existing, id: existing?.id || crypto.randomUUID(), name: values.name.trim(), description: values.description.trim(), createdAt: existing?.createdAt || new Date().toISOString().slice(0, 10) };
    if (existing) state.projects = state.projects.map((item) => item.id === record.id ? record : item);
    else state.projects.push(record);
  } else if (dialogMode.kind === 'task') {
    const recurrence = values.recurrence || 'none';
    const recurrenceAnchorDay = recurrence === 'monthly' || recurrence === 'yearly'
      ? (existing?.dueDate === values.dueDate ? existing?.recurrenceAnchorDay || Number(values.dueDate.slice(-2)) : Number(values.dueDate.slice(-2)))
      : '';
    const record = { ...existing, id: existing?.id || crypto.randomUUID(), title: values.title.trim(), projectId: values.projectId, dueDate: values.dueDate, recurrence, recurrenceAnchorDay, priority: values.priority, ownerId: values.ownerId, recipientId: values.recipientId, notes: values.notes.trim(), status: existing?.status || 'open' };
    if (existing) state.tasks = state.tasks.map((item) => item.id === record.id ? record : item);
    else state.tasks.push(record);
  } else {
    const record = { ...existing, id: existing?.id || crypto.randomUUID(), name: values.name.trim(), role: values.role.trim(), company: values.company.trim(), email: values.email.trim(), phone: values.phone.trim(), notes: values.notes.trim() };
    if (existing) state.contacts = state.contacts.map((item) => item.id === record.id ? record : item);
    else state.contacts.push(record);
  }
  saveState();
  closeDialog();
  render();
  notify('Değişiklikler kaydedildi.');
});

document.getElementById('task-search').addEventListener('input', renderTasks);
document.getElementById('task-filter').addEventListener('change', renderTasks);
document.getElementById('project-filter').addEventListener('change', renderTasks);
document.getElementById('report-start').addEventListener('change', renderReport);
document.getElementById('report-end').addEventListener('change', renderReport);
document.getElementById('report-project').addEventListener('change', renderReport);
document.getElementById('entry-dialog').addEventListener('click', (event) => {
  if (event.target === event.currentTarget) closeDialog();
});

document.getElementById('today-label').textContent = new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date());
const localToday = new Date();
const todayValue = new Date(localToday.getTime() - localToday.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
document.getElementById('report-end').value = todayValue;
document.getElementById('report-start').value = `${todayValue.slice(0, 7)}-01`;
render();
