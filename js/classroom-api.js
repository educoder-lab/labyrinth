/**
 * 授業用 Classroom API クライアント（Supabase）
 */
(function (global) {
  const SESSION_KEY = 'agy_classroom_session';
  const TEACHER_TOKEN_KEY = 'agy_teacher_token';
  const LOGIN_CACHE_KEY = 'agy_login_cache_v1';

  const FETCH_TIMEOUT_MS = 30000;
  const LOGIN_CACHE_TTL_MS = 5 * 60 * 1000;
  const SAVE_DEBOUNCE_MS = 4000;

  let saveQueue = Promise.resolve();
  let saveDebounceTimer = null;
  let pendingSaveArgs = null;
  let lastSavedHash = '';

  function getConfig() {
    return global.LABYRINTH_CONFIG || {};
  }

  function getSupabaseUrl() {
    return String(getConfig().supabaseUrl || '').trim().replace(/\/$/, '');
  }

  function getSupabaseAnonKey() {
    return String(getConfig().supabaseAnonKey || '').trim();
  }

  function isConfigured() {
    return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
  }

  function isSupabaseConfigured() {
    return isConfigured();
  }

  function backendName() {
    return isConfigured() ? 'supabase' : 'none';
  }

  function makeSessionKey(grade, className, studentNo) {
    return 'G' + grade + '-C' + className + '-N' + studentNo;
  }

  function validateApiData(action, data) {
    if (action === 'studentLogin' || action === 'saveProgress') {
      if (!data || !data.progress || !data.progress.key) {
        const err = new Error('invalid_api_response');
        err.code = 'api_invalid_response';
        throw err;
      }
    }
  }

  function parseApiResponse(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) {
      const err = new Error('empty_response');
      err.code = 'empty_response';
      throw err;
    }
    if (trimmed.charAt(0) === '<') {
      const err = new Error('html_response');
      err.code = 'html_response';
      throw err;
    }
    try {
      return JSON.parse(trimmed);
    } catch (e) {
      const err = new Error('invalid_json');
      err.code = 'invalid_json';
      throw err;
    }
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      return await fetch(url, Object.assign({}, options, { signal: controller.signal }));
    } catch (err) {
      if (err && err.name === 'AbortError') {
        const timeoutErr = new Error('timeout');
        timeoutErr.code = 'timeout';
        throw timeoutErr;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async function callSupabaseRpc(fnName, args) {
    const baseUrl = getSupabaseUrl();
    const anonKey = getSupabaseAnonKey();
    if (!baseUrl || !anonKey) throw new Error('supabase_not_configured');

    const res = await fetchWithTimeout(baseUrl + '/rest/v1/rpc/' + fnName, {
      method: 'POST',
      headers: {
        apikey: anonKey,
        Authorization: 'Bearer ' + anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(args || {})
    });
    const text = await res.text();
    if (!res.ok) {
      const err = new Error('http_' + res.status);
      err.code = res.status === 401 || res.status === 403 ? 'supabase_auth_error' : 'http_' + res.status;
      err.detail = text.slice(0, 200);
      throw err;
    }
    const data = parseApiResponse(text);
    if (!data || data.ok === false) {
      const err = new Error((data && data.error) || 'api_error');
      err.code = data && data.error;
      throw err;
    }
    return data;
  }

  async function callBackend(action, payload) {
    let data;
    if (action === 'studentLogin') {
      data = await callSupabaseRpc('student_login', {
        p_grade: Number(payload.grade),
        p_class_name: Number(payload.className),
        p_student_no: Number(payload.studentNo)
      });
    } else if (action === 'saveProgress') {
      data = await callSupabaseRpc('save_progress', {
        p_grade: Number(payload.grade),
        p_class_name: Number(payload.className),
        p_student_no: Number(payload.studentNo),
        p_cleared: payload.cleared || '',
        p_perfect: payload.perfect || '',
        p_master_cleared: payload.masterCleared || '',
        p_master_perfect: payload.masterPerfect || '',
        p_medals: payload.medals || '',
        p_reset: payload.reset === true || payload.reset === 'true' || payload.reset === '1'
      });
    } else if (action === 'teacherLogin') {
      data = await callSupabaseRpc('teacher_login', {
        p_password: String(payload.password || '')
      });
    } else if (action === 'getClassProgress') {
      data = await callSupabaseRpc('get_class_progress', {
        p_token: String(payload.token || ''),
        p_grade: Number(payload.grade),
        p_class_name: Number(payload.className)
      });
    } else {
      throw new Error('unknown_action');
    }
    validateApiData(action, data);
    return data;
  }

  function csvToIndexMap(csv) {
    const map = {};
    String(csv || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((n) => {
        const stageNum = Number(n);
        if (!Number.isFinite(stageNum) || stageNum < 1) return;
        map[stageNum - 1] = true;
      });
    return map;
  }

  function indexMapToCsv(map) {
    return Object.keys(map || {})
      .filter((k) => map[k])
      .map((k) => Number(k) + 1)
      .filter((n) => Number.isFinite(n) && n >= 1)
      .sort((a, b) => a - b)
      .join(',');
  }

  function progressFromSheet(row) {
    return {
      standard: {
        cleared: csvToIndexMap(row.cleared),
        perfect: csvToIndexMap(row.perfect)
      },
      master: {
        cleared: csvToIndexMap(row.masterCleared),
        perfect: csvToIndexMap(row.masterPerfect)
      },
      medals: String(row.medals || ''),
      updatedAt: row.updatedAt || '',
      key: row.key || ''
    };
  }

  function sheetPayloadFromGameProgress(gameProgress, medalIds) {
    return {
      cleared: indexMapToCsv(gameProgress.standard && gameProgress.standard.cleared),
      perfect: indexMapToCsv(gameProgress.standard && gameProgress.standard.perfect),
      masterCleared: indexMapToCsv(gameProgress.master && gameProgress.master.cleared),
      masterPerfect: indexMapToCsv(gameProgress.master && gameProgress.master.perfect),
      medals: (medalIds || []).join(',')
    };
  }

  function buildLoginResult(data, grade, className, studentNo) {
    const session = {
      grade: Number(grade),
      className: Number(className),
      studentNo: Number(studentNo),
      key: data.progress.key
    };
    setStudentSession(session);
    return {
      session,
      progress: progressFromSheet(data.progress),
      created: data.created
    };
  }

  function getLoginCache(grade, className, studentNo) {
    try {
      const raw = sessionStorage.getItem(LOGIN_CACHE_KEY);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (
        Number(cached.grade) !== Number(grade) ||
        Number(cached.className) !== Number(className) ||
        Number(cached.studentNo) !== Number(studentNo)
      ) {
        return null;
      }
      if (Date.now() - cached.at > LOGIN_CACHE_TTL_MS) return null;
      return cached.result;
    } catch (e) {
      return null;
    }
  }

  function setLoginCache(grade, className, studentNo, result) {
    try {
      sessionStorage.setItem(LOGIN_CACHE_KEY, JSON.stringify({
        grade: Number(grade),
        className: Number(className),
        studentNo: Number(studentNo),
        at: Date.now(),
        result
      }));
    } catch (e) {}
  }

  function clearLoginCache() {
    try {
      sessionStorage.removeItem(LOGIN_CACHE_KEY);
    } catch (e) {}
  }

  function getStudentSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function setStudentSession(session) {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
  }

  function clearStudentSession() {
    sessionStorage.removeItem(SESSION_KEY);
    clearLoginCache();
    lastSavedHash = '';
  }

  function getTeacherToken() {
    try {
      return sessionStorage.getItem(TEACHER_TOKEN_KEY) || '';
    } catch (e) {
      return '';
    }
  }

  function setTeacherToken(token) {
    sessionStorage.setItem(TEACHER_TOKEN_KEY, token || '');
  }

  function clearTeacherToken() {
    sessionStorage.removeItem(TEACHER_TOKEN_KEY);
  }

  async function studentLogin(grade, className, studentNo, options) {
    const force = options && options.force;
    if (!force) {
      const cached = getLoginCache(grade, className, studentNo);
      if (cached) return cached;
    }

    const data = await callBackend('studentLogin', {
      grade: Number(grade),
      className: Number(className),
      studentNo: Number(studentNo)
    });
    const result = buildLoginResult(data, grade, className, studentNo);
    setLoginCache(grade, className, studentNo, result);
    return result;
  }

  function hashSavePayload(payload, reset) {
    return JSON.stringify({
      reset: Boolean(reset),
      cleared: payload.cleared,
      perfect: payload.perfect,
      masterCleared: payload.masterCleared,
      masterPerfect: payload.masterPerfect,
      medals: payload.medals
    });
  }

  async function runSaveProgress(gameProgress, medalIds, options) {
    const session = getStudentSession();
    if (!session) throw new Error('no_session');
    const reset = options && options.reset;
    const payload = sheetPayloadFromGameProgress(gameProgress, medalIds);
    const hash = hashSavePayload(payload, reset);
    if (!reset && hash === lastSavedHash) return null;

    const data = await callBackend('saveProgress', {
      grade: session.grade,
      className: session.className,
      studentNo: session.studentNo,
      cleared: payload.cleared,
      perfect: payload.perfect,
      masterCleared: payload.masterCleared,
      masterPerfect: payload.masterPerfect,
      medals: payload.medals,
      reset: reset ? 'true' : undefined
    });
    lastSavedHash = hash;
    return progressFromSheet(data.progress);
  }

  function saveProgress(gameProgress, medalIds, options) {
    const immediate = options && (options.reset || options.immediate);
    pendingSaveArgs = { gameProgress, medalIds, options: options || {} };

    if (immediate) {
      if (saveDebounceTimer) {
        clearTimeout(saveDebounceTimer);
        saveDebounceTimer = null;
      }
      saveQueue = saveQueue.then(
        () => runSaveProgress(pendingSaveArgs.gameProgress, pendingSaveArgs.medalIds, pendingSaveArgs.options),
        () => runSaveProgress(pendingSaveArgs.gameProgress, pendingSaveArgs.medalIds, pendingSaveArgs.options)
      );
      return saveQueue;
    }

    return new Promise((resolve, reject) => {
      if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
      saveDebounceTimer = setTimeout(() => {
        saveDebounceTimer = null;
        saveQueue = saveQueue.then(() => {
          if (!pendingSaveArgs) return null;
          return runSaveProgress(pendingSaveArgs.gameProgress, pendingSaveArgs.medalIds, pendingSaveArgs.options);
        }, () => {
          if (!pendingSaveArgs) return null;
          return runSaveProgress(pendingSaveArgs.gameProgress, pendingSaveArgs.medalIds, pendingSaveArgs.options);
        });
        saveQueue.then(resolve).catch(reject);
      }, SAVE_DEBOUNCE_MS);
    });
  }

  function flushSaveProgress() {
    if (!pendingSaveArgs) return Promise.resolve(null);
    if (saveDebounceTimer) {
      clearTimeout(saveDebounceTimer);
      saveDebounceTimer = null;
    }
    const args = pendingSaveArgs;
    saveQueue = saveQueue.then(
      () => runSaveProgress(args.gameProgress, args.medalIds, Object.assign({}, args.options, { immediate: true })),
      () => runSaveProgress(args.gameProgress, args.medalIds, Object.assign({}, args.options, { immediate: true }))
    );
    return saveQueue;
  }

  async function teacherLogin(password) {
    const data = await callBackend('teacherLogin', {
      password: String(password || '')
    });
    setTeacherToken(data.token);
    return data;
  }

  async function getClassProgress(grade, className) {
    const token = getTeacherToken();
    if (!token) throw new Error('unauthorized');
    const data = await callBackend('getClassProgress', {
      token,
      grade: Number(grade),
      className: Number(className)
    });
    return {
      grade: data.grade,
      className: data.className,
      students: (data.students || []).map((row) => ({
        ...row,
        parsed: progressFromSheet(row)
      }))
    };
  }

  async function seedClassRows(grade, className, maxStudent) {
    return callSupabaseRpc('seed_class_rows', {
      p_grade: Number(grade),
      p_class_name: Number(className),
      p_max_student: Number(maxStudent || 30)
    });
  }

  global.ClassroomAPI = {
    isConfigured,
    isSupabaseConfigured,
    backendName,
    getSupabaseUrl,
    makeSessionKey,
    studentLogin,
    saveProgress,
    flushSaveProgress,
    teacherLogin,
    getClassProgress,
    seedClassRows,
    getStudentSession,
    setStudentSession,
    clearStudentSession,
    getTeacherToken,
    clearTeacherToken,
    progressFromSheet,
    sheetPayloadFromGameProgress,
    indexMapToCsv,
    csvToIndexMap
  };
})(window);
