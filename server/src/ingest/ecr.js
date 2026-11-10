// PF and ESIC ECR parsers. Both are header-driven (see table.js) and page-count agnostic.
// Printed totals are captured so verify/reconcile.js can prove no row was dropped.
import { extractTable, findTotal, toNumber } from './table.js';
import { normId } from '../verify/ids.js';
import { CFG } from '../config.js';

const PF_SPEC = {
  anchors: [/^UAN$/, /NAME/],
  idKey: 'uan',
  idPattern: new RegExp(`^\\d{${CFG.UAN_DIGITS}}$`),
  wrapKeys: ['ecrName', 'uanName'],
  columns: {
    uan: /^UAN( NO)?$/,
    uanName: /UAN REPOSITORY/,
    ecrName: /NAME AS PER ECR|^NAME$|MEMBER NAME/,
    gross: /GROSS/,
    epfWages: /^EPF WAGES/,
    epsWages: /^EPS WAGES/,
    edliWages: /EDLI/,
    ee: /^EE( SHARE)?$|EMPLOYEE SHARE|EPF EE/,
    eps: /^EPS$|EPS CONTRIBUTION/,
    er: /^ER( SHARE)?$|EPF EPS DIFF/,
    ncp: /NCP/,
  },
};

const ESIC_SPEC = {
  anchors: [/IP NUMBER|IP NO/, /NAME/],
  idKey: 'ip',
  idPattern: new RegExp(`^\\d{${CFG.IP_DIGITS_MIN},${CFG.IP_DIGITS_MAX}}$`),
  wrapKeys: ['name'],
  columns: {
    ip: /IP NUMBER|IP NO|INSURANCE NUMBER/,
    name: /IP NAME|^NAME/,
    disabled: /DISABLE/,
    days: /DAYS/,
    wages: /WAGES/,
    contribution: /IP CONTRIBUTION|EMPLOYEE CONTRIBUTION/,
    reason: /REASON/,
  },
};

export function parsePfEcr(pdf) {
  const t = extractTable(pdf.pages, PF_SPEC);
  const rows = t.rows.map((r) => ({
    id: normId(r.uan),
    ecrName: r.ecrName,
    uanName: r.uanName,
    grossWages: toNumber(r.gross),
    epfWages: toNumber(r.epfWages),
    amount: toNumber(r.ee), // EE share = employee PF deposited
    eps: toNumber(r.eps),
    er: toNumber(r.er),
    ncpDays: toNumber(r.ncp),
    page: r._page,
  }));
  const wm = pdf.text.match(/Wage Month\s+([A-Z]{3}-?\s?\d{4})/i);
  return {
    kind: 'PF',
    rows,
    wageMonth: wm ? wm[1].toUpperCase().replace(/[\s-]/g, '') : null,
    totals: {
      members: findTotal(pdf.pages, /^TOTAL MEMBERS$/),
      amount: findTotal(pdf.pages, /^TOTAL EPF CONTRIBUTION$/),
      eps: findTotal(pdf.pages, /^TOTAL EPS CONTRIBUTION$/),
      er: findTotal(pdf.pages, /^TOTAL EPF EPS CONTRIBUTION$/),
    },
    pages: pdf.pages.length,
    headersFound: t.headersFound,
    warnings: t.warnings,
  };
}

export function parseEsicEcr(pdf) {
  const t = extractTable(pdf.pages, ESIC_SPEC);
  const rows = t.rows.map((r) => ({
    id: normId(r.ip),
    ecrName: r.name,
    disabled: r.disabled && r.disabled !== '-' ? r.disabled : '',
    days: toNumber(r.days),
    wages: toNumber(r.wages),
    amount: toNumber(r.contribution), // IP contribution = employee ESIC deposited
    reason: r.reason && r.reason !== '-' ? r.reason : '',
    page: r._page,
  }));
  const wm = pdf.text.match(/for\s+([A-Za-z]{3})[\s-]?(\d{4})/i);
  return {
    kind: 'ESIC',
    rows,
    wageMonth: wm ? `${wm[1].toUpperCase()}${wm[2]}` : null,
    totals: {
      members: null, // ESIC history doesn't print a member count
      amount: findTotal(pdf.pages, /^TOTAL IP CONTRIBUTION$/),
      wages: findTotal(pdf.pages, /^TOTAL MONTHLY WAGES$/),
    },
    pages: pdf.pages.length,
    headersFound: t.headersFound,
    warnings: t.warnings,
  };
}
