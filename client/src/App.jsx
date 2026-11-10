import React, { useEffect, useMemo, useState } from 'react';

const STATUSES = ['MATCHED', 'NAME_MISMATCH', 'AMOUNT_MISMATCH', 'MISSING', 'NOT_APPLICABLE'];
const LABEL = { MATCHED: 'Matched', NAME_MISMATCH: 'Name mismatch', AMOUNT_MISMATCH: 'Amount mismatch', MISSING: 'Missing', NOT_APPLICABLE: 'Not applicable' };
const inr = (v) => (v === null || v === undefined ? '' : `₹${Number(v).toLocaleString('en-IN')}`);

async function api(path, opts) {
  const r = await fetch(`/api${path}`, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `HTTP ${r.status}`);
  return body;
}

export default function App() {
  const [run, setRun] = useState(null);
  const [history, setHistory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const refresh = () => api('/runs').then(setHistory).catch(() => {});

  useEffect(() => {
    refresh();
    const id = new URLSearchParams(location.search).get('run');
    if (id) api(`/runs/${id}`).then(setRun).catch((e) => setErr(e.message));
  }, []);

  const show = (r) => { setRun(r); window.history.replaceState(null, '', r ? `?run=${r.id}` : location.pathname); refresh(); };

  const go = async (fn) => {
    setBusy(true); setErr('');
    try { show(await fn()); } catch (e) { setErr(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="wrap">
      <header>
        <h1>Wagesheet vs ECR verification</h1>
        <p>Check, employee by employee, that the PF and ESIC deducted in the vendor wagesheet was deposited with EPFO and ESIC: right person, right identifier, right amount.</p>
      </header>
      <Upload busy={busy} onRun={(fd) => go(() => api('/runs', { method: 'POST', body: fd }))} onSample={() => go(() => api('/runs/sample', { method: 'POST' }))} />
      {err && <div className="error">{err}</div>}
      {run ? <Result run={run} onBack={() => show(null)} /> : <History items={history} onOpen={(id) => api(`/runs/${id}`).then(show)} />}
    </div>
  );
}

function Upload({ busy, onRun, onSample }) {
  const [files, setFiles] = useState({});
  const ready = files.wagesheet && files.pf && files.esic;
  const submit = () => {
    const fd = new FormData();
    for (const k of ['wagesheet', 'pf', 'esic']) fd.append(k, files[k]);
    onRun(fd);
  };
  const slot = (k, label, accept) => (
    <label className={`slot ${files[k] ? 'filled' : ''}`}>
      <span className="slot-title">{label}</span>
      <input type="file" accept={accept} onChange={(e) => setFiles({ ...files, [k]: e.target.files[0] })} />
      <span className="slot-file">{files[k] ? files[k].name : 'choose file'}</span>
    </label>
  );
  return (
    <section className="upload">
      <div className="slots">
        {slot('wagesheet', '1 · Vendor wagesheet', '.xlsx,.csv,.pdf')}
        {slot('pf', '2 · PF ECR (PDF)', '.pdf')}
        {slot('esic', '3 · ESIC ECR (PDF)', '.pdf')}
      </div>
      <div className="actions">
        <button className="primary" disabled={!ready || busy} onClick={submit}>{busy ? 'Verifying…' : 'Verify'}</button>
        <button className="link" disabled={busy} onClick={onSample}>or try the provided sample files</button>
      </div>
    </section>
  );
}

function History({ items, onOpen }) {
  if (!items.length) return <p className="muted">No runs yet.</p>;
  return (
    <section>
      <h2>Previous runs</h2>
      <table>
        <thead><tr><th>When</th><th>Wagesheet</th><th>PF matched / total</th><th>ESIC matched / total</th><th>Reconciliation</th></tr></thead>
        <tbody>
          {items.map((h) => {
            const t = (c) => Object.values(c).reduce((a, b) => a + b, 0);
            return (
              <tr key={h.id} className="click" onClick={() => onOpen(h.id)}>
                <td>{new Date(h.createdAt).toLocaleString()}</td><td>{h.files.wagesheet}</td>
                <td>{h.summary.PF.MATCHED}/{t(h.summary.PF)}</td><td>{h.summary.ESIC.MATCHED}/{t(h.summary.ESIC)}</td>
                <td>{h.reconciliationOk ? '✔' : '✖'}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

function Result({ run, onBack }) {
  const r = run.result;
  const [auth, setAuth] = useState('ALL');
  const [status, setStatus] = useState('ISSUES');
  const [q, setQ] = useState('');

  const rows = useMemo(() => r.employees.filter((e) => {
    const sts = auth === 'PF' ? [e.pf.status] : auth === 'ESIC' ? [e.esic.status] : [e.pf.status, e.esic.status];
    const okStatus = status === 'ALL' ? true : status === 'ISSUES' ? sts.some((s) => s !== 'MATCHED') : sts.includes(status);
    const okQ = !q || `${e.emp.name} ${e.emp.uan} ${e.emp.ip}`.toLowerCase().includes(q.toLowerCase());
    return okStatus && okQ;
  }), [r, auth, status, q]);

  return (
    <section>
      <div className="bar">
        <button className="link" onClick={onBack}>← all runs</button>
        <span className="muted small">{r.meta.files.wagesheet} · {r.meta.files.pf} · {r.meta.files.esic} · {r.meta.counts.wagesheet} employees · {r.meta.ms} ms</span>
        <span className="grow" />
        <a className="primary btn" href={`/api/runs/${run.id}/report.xlsx`}>Download report (.xlsx)</a>
        <a className="link" href={`/api/runs/${run.id}/report.csv`}>CSV</a>
      </div>

      {!r.reconciliation.ok && <div className="error">⚠ {r.reconciliation.failed} reconciliation check(s) failed: some ECR rows may not have been read. Verdicts may be incomplete.</div>}

      <div className="cards">
        {['PF', 'ESIC'].map((k) => (
          <div className="card" key={k}>
            <h3>{k} <span className="muted small">wage month {r.meta.wageMonth[k] || '?'} · {k === 'PF' ? r.meta.counts.pf : r.meta.counts.esic} rows in ECR</span></h3>
            <div className="counts">
              {STATUSES.filter((s) => r.summary[k].counts[s] || s !== 'NOT_APPLICABLE').map((s) => (
                <button key={s} className={`count st-${s}`} onClick={() => { setAuth(k); setStatus(s); }}>
                  <b>{r.summary[k].counts[s]}</b><span>{LABEL[s]}</span>
                </button>
              ))}
            </div>
            <p className="small">Deducted {inr(r.summary[k].deducted)} · deposited {inr(r.summary[k].deposited)} · <b>short {inr(r.summary[k].shortfall)}</b></p>
          </div>
        ))}
        <div className="card">
          <h3>Reconciliation <span className="muted small">parsed vs printed totals</span></h3>
          <ul className="recon">
            {r.reconciliation.checks.map((c) => (
              <li key={c.doc + c.check}><span className={c.ok === false ? 'bad' : 'ok'}>{c.ok === null ? '–' : c.ok ? '✔' : '✖'}</span> {c.doc}: {c.check} <span className="muted">({c.printed ?? 'n/a'} / {c.parsed})</span></li>
            ))}
          </ul>
          {(r.extras.length > 0 || r.dataIssues.length > 0) && <p className="small">{r.extras.length} ECR row(s) not in wagesheet · {r.dataIssues.length} data issue(s) — see the report</p>}
        </div>
      </div>

      <div className="filters">
        {['ALL', 'PF', 'ESIC'].map((a) => <button key={a} className={`chip ${auth === a ? 'on' : ''}`} onClick={() => setAuth(a)}>{a === 'ALL' ? 'PF + ESIC' : a}</button>)}
        <span className="sep" />
        {['ISSUES', 'ALL', ...STATUSES].map((s) => <button key={s} className={`chip ${status === s ? 'on' : ''}`} onClick={() => setStatus(s)}>{s === 'ISSUES' ? 'Only issues' : s === 'ALL' ? 'Everyone' : LABEL[s]}</button>)}
        <input placeholder="Search name / UAN / IP" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="table-wrap">
        <table>
          <thead><tr><th>Employee</th><th>UAN · IP</th><th>PF</th><th>ESIC</th></tr></thead>
          <tbody>
            {rows.slice(0, 1000).map((e) => (
              <tr key={`${e.emp.rowNo}-${e.emp.uan}-${e.emp.ip}`}>
                <td><b>{e.emp.name}</b><div className="muted small">{e.emp.agency} {e.emp.state}</div></td>
                <td className="mono">{e.emp.uan || '—'}<br />{e.emp.ip || '—'}</td>
                <Cell v={e.pf} />
                <Cell v={e.esic} />
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length > 1000 && <p className="muted small">Showing 1,000 of {rows.length}. Download the report for all rows.</p>}
        {!rows.length && <p className="muted">No employees match this filter.</p>}
      </div>
    </section>
  );
}

function Cell({ v }) {
  return (
    <td>
      <span className={`badge st-${v.status}`}>{LABEL[v.status]}</span>
      {v.difference ? <span className={`diff ${v.difference < 0 ? 'neg' : ''}`}> {inr(v.difference)}</span> : null}
      <div className="reason">{v.reason}</div>
      {v.notes?.length > 0 && <div className="muted small">{v.notes.join(' · ')}</div>}
    </td>
  );
}
