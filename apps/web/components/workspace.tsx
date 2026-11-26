'use client';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { z } from 'zod';
import {
  Plus,
  ArrowDownLeft,
  ArrowUpRight,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight,
  Wallet,
  Landmark,
  Smartphone,
  Banknote,
  Pencil,
  Scale,
  Archive,
  Tags,
  MoveLeft,
  Sparkles,
  Receipt,
  Search,
  X,
} from 'lucide-react';
import {
  monthLabel,
  monthSchema,
  dateRangeSchema,
  rupiah,
  shiftMonth,
  today,
  type Account,
  type Category,
  type DateRange,
  type Snapshot,
  type Transaction,
} from '@money/core';
import { ApiError, createClient } from '@money/api-client';
import { AccountForm, AmountInput, CategoryForm, Modal, TransactionForm } from './forms';
import { BudgetForm, BudgetOverview, BudgetPeriod } from './budgets';
import { SelectField } from './pickers';
import { SwipeCategory } from './swipe-category';

const api = createClient();
const budgetPeriodSchema = z.object({ month: monthSchema, range: dateRangeSchema.optional() });
const budgetPeriodKey = (userId: string) => `money-budget-period:${userId}`;
function readBudgetPeriod(userId: string) {
  try {
    const stored = localStorage.getItem(budgetPeriodKey(userId));
    return budgetPeriodSchema.safeParse(stored ? JSON.parse(stored) : null).data;
  } catch {
    // Keep the default period when browser storage is unavailable or invalid.
  }
}
function budgetPeriodLabel(month: string, range?: DateRange) {
  if (!range) return monthLabel(month);
  const format = new Intl.DateTimeFormat('id-ID', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return [range.start, range.end]
    .map((date) => format.format(new Date(`${date}T00:00:00Z`)))
    .join(' – ');
}
const titles: Record<string, string> = {
  dashboard: 'Beranda',
  transactions: 'Transaksi',
  accounts: 'Rekening & dompet',
  categories: 'Kategori & anggaran',
  budgets: 'Anggaran bulanan',
};
function accountColor(a: Account) {
  const name = a.name.toLowerCase();
  return name.includes('bni')
    ? '#bd510c'
    : name.includes('mandiri')
      ? '#003d79'
      : name.includes('jago')
        ? '#926501'
        : name.includes('gopay')
          ? '#007c96'
          : name.includes('shopee')
            ? '#d43518'
            : name.includes('bca')
              ? '#0060af'
              : name.includes('ovo')
                ? '#4c3494'
                : name.includes('dana')
                  ? '#0f7ac9'
                  : a.type === 'cash'
                    ? '#2b8473'
                    : '#715ef2';
}
const AccountIcon = ({ type }: { type: string }) =>
  type === 'bank' ? (
    <Landmark size={20} />
  ) : type === 'ewallet' ? (
    <Smartphone size={20} />
  ) : (
    <Banknote size={20} />
  );
type Editor =
  | { type: 'transaction'; tx?: Transaction }
  | { type: 'account'; account?: Account }
  | { type: 'reconcile'; account: Account }
  | { type: 'budget'; category?: Category }
  | { type: 'category' };
export function Workspace({ section }: { section: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountFromUrl = searchParams.get('account') ?? '';
  const [month, setMonth] = useState(today().slice(0, 7)),
    [account, setAccount] = useState(accountFromUrl);
  const [budgetRange, setBudgetRange] = useState<DateRange>();
  const [query, setQuery] = useState('');
  const searchTerm = query.trim().toLocaleLowerCase('id-ID');
  const periodContext = useRef('');
  const requestId = useRef<string | undefined>(undefined);
  const [pages, setPages] = useState<string[]>([]);
  const cursor = pages.at(-1);
  const effectiveMonth = budgetRange?.end.slice(0, 7) ?? month;
  const selectedRange = ['budgets', 'categories'].includes(section) ? budgetRange : undefined;
  const periodLabel = budgetPeriodLabel(month, selectedRange);
  useEffect(() => {
    setAccount(accountFromUrl);
    setPages([]);
  }, [accountFromUrl]);
  const [data, setData] = useState<Snapshot>(),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const [dashboardBudget, setDashboardBudget] = useState<{
    label: string;
    categories: Category[];
  }>();
  const [editor, setEditor] = useState<Editor>(),
    [quick, setQuick] = useState<Snapshot['quick_fills'][number]>(),
    [formKey, setFormKey] = useState(0),
    [revision, setRevision] = useState(0);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<{
    message: string;
    path: string;
    method: string;
    body?: unknown;
  }>();
  const selectedAccount = section === 'transactions' ? account : '';
  const [page, setPage] = useState<Pick<Snapshot, 'transactions' | 'next_cursor'>>();
  const [pageLoading, setPageLoading] = useState(false);
  const matches = page?.transactions ?? [];
  useEffect(() => {
    if (section !== 'transactions') return;
    const controller = new AbortController();
    setPageLoading(true);
    setPage(undefined);
    const timer = setTimeout(
      () => {
        const params = new URLSearchParams({
          month,
          ...(selectedAccount ? { account: selectedAccount } : {}),
          ...(cursor ? { cursor } : {}),
          ...(searchTerm ? { q: searchTerm } : {}),
        });
        api
          .request<Pick<Snapshot, 'transactions' | 'next_cursor'>>(
            `transactions?${params}`,
            'GET',
            undefined,
            undefined,
            controller.signal,
          )
          .then((result) => {
            if (!controller.signal.aborted) setPage(result);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setPageLoading(false);
          });
      },
      searchTerm ? 200 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [section, month, selectedAccount, cursor, searchTerm, revision]);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !busy && !editor)
        setRevision((value) => value + 1);
    }, 60000);
    return () => clearInterval(timer);
  }, [busy, editor]);
  const selectedMonth = ['transactions', 'categories', 'budgets'].includes(section)
    ? month
    : today().slice(0, 7);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .snapshot(selectedMonth, selectedAccount, selectedRange, section)
      .then(async (d) => {
        if (!active) return;
        if (section === 'dashboard') {
          setData(d);
          const saved = readBudgetPeriod(d.user.id);
          const budgetMonth = saved?.month ?? selectedMonth;
          const range = saved?.range;
          const budget =
            range || budgetMonth !== selectedMonth
              ? await api.snapshot(budgetMonth, '', range, 'budgets')
              : d;
          if (active)
            setDashboardBudget({
              label: budgetPeriodLabel(budgetMonth, range),
              categories: budget.categories,
            });
          return;
        }
        const context = `${d.user.id}:${section}`;
        if (periodContext.current !== context) {
          periodContext.current = context;
          if (['budgets', 'categories'].includes(section)) {
            const saved = readBudgetPeriod(d.user.id);
            if (saved) {
              const { month: savedMonth, range } = saved;
              if (
                savedMonth !== month ||
                range?.start !== budgetRange?.start ||
                range?.end !== budgetRange?.end
              ) {
                setMonth(savedMonth);
                setBudgetRange(range);
                return;
              }
            }
          }
        }
        setData(d);
      })
      .catch((e) => {
        if (active) {
          setError(e.message);
          if (e instanceof ApiError && e.status === 401) {
            router.replace('/login');
            router.refresh();
          }
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [selectedMonth, selectedAccount, selectedRange, revision, router, section]);
  function saveBudgetPeriod(nextMonth: string, range?: DateRange) {
    if (!data) return;
    try {
      localStorage.setItem(
        budgetPeriodKey(data.user.id),
        JSON.stringify({ month: nextMonth, range }),
      );
    } catch {
      // The selected period still works if browser storage is unavailable.
    }
  }
  function changeBudgetRange(range?: DateRange) {
    setBudgetRange(range);
    saveBudgetPeriod(month, range);
  }
  function changeMonth(nextMonth: string) {
    setPages([]);
    setMonth(nextMonth);
    if (['budgets', 'categories'].includes(section)) saveBudgetPeriod(nextMonth, budgetRange);
  }
  async function run(path: string, method: string, body?: unknown) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const creating = path === 'transactions' && method === 'POST';
      if (creating && !requestId.current) {
        const bytes = crypto.getRandomValues(new Uint8Array(16));
        bytes[6] = (bytes[6] & 15) | 64;
        bytes[8] = (bytes[8] & 63) | 128;
        requestId.current = Array.from(
          bytes,
          (b, i) => ([4, 6, 8, 10].includes(i) ? '-' : '') + b.toString(16).padStart(2, '0'),
        ).join('');
      }
      const result = await api.request<{ message?: string; warnings?: string[] }>(
        path,
        method,
        body,
        creating ? requestId.current : undefined,
      );
      if (creating) {
        requestId.current = undefined;
        setPages([]);
      }
      setNotice([result.message ?? 'Data disimpan.', ...(result.warnings ?? [])].join(' '));
      setEditor(undefined);
      setConfirmation(undefined);
      setOpenCategory(null);
      setQuick(undefined);
      setFormKey((k) => k + 1);
      setRevision((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function open(value: Editor) {
    if (value.type === 'transaction' && !value.tx) requestId.current = undefined;
    setError('');
    setEditor(value);
  }
  const monthNav = (
    <div className="month-nav">
      <button
        className="icon-button"
        aria-label="Bulan sebelumnya"
        disabled={month <= '1900-01'}
        onClick={() => changeMonth(shiftMonth(month, -1))}
      >
        <ChevronLeft size={20} />
      </button>
      <strong>{monthLabel(month)}</strong>
      <button
        className="icon-button"
        aria-label="Bulan berikutnya"
        disabled={month >= '9998-12'}
        onClick={() => changeMonth(shiftMonth(month, 1))}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
  return (
    <>
      <div className="page-heading">
        <div>
          <h1>{titles[section]}</h1>
          {section === 'dashboard' && (
            <p className="muted">Saldo hari ini dan arus uang bulan ini.</p>
          )}
        </div>
        {section === 'dashboard' ? (
          data && (
            <a href="#catat-transaksi" className="btn primary">
              <Plus size={18} /> Catat transaksi
            </a>
          )
        ) : (
          <button
            className="btn primary"
            disabled={busy || !data}
            onClick={() =>
              open(
                section === 'accounts'
                  ? { type: 'account' }
                  : section === 'categories'
                    ? { type: 'category' }
                    : section === 'budgets'
                      ? { type: 'budget' }
                      : { type: 'transaction' },
              )
            }
          >
            <Plus size={18} />
            <span>
              {section === 'accounts'
                ? 'Tambah akun'
                : section === 'categories'
                  ? 'Tambah kategori'
                  : section === 'budgets'
                    ? 'Tambah anggaran'
                    : 'Catat transaksi'}
            </span>
          </button>
        )}
      </div>
      {error && (
        <div className="flash error" role="alert">
          {error}
          <button className="icon-button" aria-label="Tutup pesan" onClick={() => setError('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {notice && (
        <div className="flash success" role="status">
          {notice}
          <button className="icon-button" aria-label="Tutup pesan" onClick={() => setNotice('')}>
            <X size={16} />
          </button>
        </div>
      )}
      {!data ? (
        <section className="card empty" aria-busy={loading}>
          {loading ? (
            'Memuat…'
          ) : (
            <>
              <p>Data belum bisa dimuat.</p>
              <button className="btn" onClick={() => setRevision((r) => r + 1)}>
                Coba lagi
              </button>
            </>
          )}
        </section>
      ) : (
        <div aria-busy={loading} className={loading ? 'workspace refreshing' : 'workspace'}>
          {section === 'dashboard' && (
            <>
              {data.needs_setup && (
                <div className="flash success">
                  <span>Isi saldo awal untuk mulai mencatat.</span>
                  <Link href="/accounts">Isi saldo awal →</Link>
                </div>
              )}
              <section className="hero">
                <div className="hero-top">
                  <span className="hero-label">Total saldo</span>
                  <Wallet size={20} aria-hidden="true" />
                </div>
                <p className="hero-total">{rupiah(data.total)}</p>
                <p className="flow-period">Arus uang · {monthLabel(data.month)}</p>
                <div className="hero-stats">
                  <div>
                    <span className="round-icon">
                      <ArrowUpRight size={20} />
                    </span>
                    <span>
                      <small>Pemasukan</small>
                      <strong>{rupiah(data.summary.income)}</strong>
                    </span>
                  </div>
                  <div>
                    <span className="round-icon">
                      <ArrowDownLeft size={20} />
                    </span>
                    <span>
                      <small>Pengeluaran</small>
                      <strong>{rupiah(data.summary.expense)}</strong>
                    </span>
                  </div>
                </div>
              </section>
              <section>
                <div className="section-head">
                  <h2>Rekening & dompet</h2>
                  <Link href="/accounts">Kelola akun ↗</Link>
                </div>
                <div className="balance-grid">
                  {data.accounts
                    .filter((a) => !a.archived)
                    .map((a) => (
                      <Link
                        href={`/transactions?account=${a.id}`}
                        className="balance-tile"
                        key={a.id}
                        style={{ '--account-color': accountColor(a) } as CSSProperties}
                      >
                        <AccountIcon type={a.type} />
                        <span>{a.name}</span>
                        <strong>{rupiah(a.balance)}</strong>
                      </Link>
                    ))}
                </div>
              </section>
              <div className="dashboard-columns">
                <section className="card">
                  <div className="section-head">
                    <h2 id="catat-transaksi" tabIndex={-1}>
                      Catat transaksi
                    </h2>
                    <span className="soft-icon">
                      <Plus size={19} />
                    </span>
                  </div>
                  {data.quick_fills.length > 0 && (
                    <div className="chips">
                      {data.quick_fills.map((q, i) => (
                        <button className="chip" key={i} onClick={() => setQuick(q)}>
                          <Sparkles size={13} />
                          {q.note} · {rupiah(q.amount)}
                        </button>
                      ))}
                    </div>
                  )}
                  <TransactionForm
                    key={formKey}
                    data={data}
                    quick={quick}
                    busy={busy}
                    onSave={(body) => run('transactions', 'POST', body)}
                  />
                </section>
                <section className="card">
                  <div className="section-head">
                    <h2>Transaksi terakhir</h2>
                    <Link href="/transactions">Lihat semua ↗</Link>
                  </div>
                  <TransactionList
                    transactions={data.recent}
                    onEdit={(tx) => open({ type: 'transaction', tx })}
                  />
                </section>
              </div>
              <section className="card">
                <div className="section-head">
                  <div>
                    <h2>Anggaran</h2>
                    {dashboardBudget && <p className="muted">{dashboardBudget.label}</p>}
                  </div>
                  <Link href="/budgets">Kelola anggaran ↗</Link>
                </div>
                {dashboardBudget && <BudgetOverview categories={dashboardBudget.categories} />}
              </section>
            </>
          )}
          {section === 'transactions' && (
            <>
              <section className="card">
                <div className="section-head">
                  {monthNav}
                  <label className="filter-label">
                    Akun
                    <SelectField
                      label="Filter akun"
                      value={account}
                      onValueChange={(value) => {
                        setAccount(value);
                        setPages([]);
                      }}
                      options={[
                        { value: '', label: 'Semua akun' },
                        ...data.accounts.map((a) => ({
                          value: a.id,
                          label: `${a.name}${a.archived ? ' (arsip)' : ''}`,
                        })),
                      ]}
                    />
                  </label>
                </div>
                <div className="summary-grid">
                  <div className="summary-stat income">
                    <ArrowUpRight />
                    <span>
                      <small>Pemasukan</small>
                      <strong>{rupiah(data.summary.income)}</strong>
                    </span>
                  </div>
                  <div className="summary-stat expense">
                    <ArrowDownLeft />
                    <span>
                      <small>Pengeluaran</small>
                      <strong>{rupiah(data.summary.expense)}</strong>
                    </span>
                  </div>
                </div>
              </section>
              <section className="card">
                <div className="history-tools">
                  <h2>Riwayat transaksi</h2>
                  <label className="history-search">
                    <Search size={18} aria-hidden="true" />
                    <input
                      aria-label="Cari transaksi"
                      type="search"
                      maxLength={200}
                      placeholder="Cari catatan, kategori, atau akun"
                      value={query}
                      onChange={(event) => {
                        setQuery(event.target.value);
                        setPages([]);
                      }}
                    />
                  </label>
                </div>
                {searchTerm && page && (
                  <p className="muted" role="status">
                    {matches.length} transaksi ditemukan di halaman ini
                  </p>
                )}
                {pageLoading ? (
                  <p role="status">Memuat transaksi…</p>
                ) : !page ? (
                  <button className="btn" onClick={() => setRevision((r) => r + 1)}>
                    Muat ulang riwayat
                  </button>
                ) : searchTerm && !matches.length ? (
                  <div className="empty">
                    <Search aria-hidden="true" />
                    <strong>Tidak ada transaksi yang cocok</strong>
                    <p>Coba kata lain atau periksa bulan dan akun yang dipilih.</p>
                    <button
                      className="btn"
                      onClick={() => {
                        setQuery('');
                        setPages([]);
                      }}
                    >
                      Hapus pencarian
                    </button>
                  </div>
                ) : (
                  <TransactionList
                    transactions={matches}
                    onEdit={(tx) => open({ type: 'transaction', tx })}
                  />
                )}
                {pages.length > 0 && (
                  <button
                    className="btn"
                    disabled={loading}
                    onClick={() => setPages((p) => p.slice(0, -1))}
                  >
                    Halaman sebelumnya
                  </button>
                )}
                {page?.next_cursor && (
                  <button
                    className="btn"
                    disabled={pageLoading}
                    onClick={() => setPages((p) => [...p, page.next_cursor!])}
                  >
                    Halaman berikutnya
                  </button>
                )}
              </section>
            </>
          )}
          {section === 'accounts' && (
            <>
              <section className="card">
                <div className="section-head">
                  <h2>Akun aktif</h2>
                  <span className="muted">
                    {data.accounts.filter((a) => !a.archived).length} akun
                  </span>
                </div>
                <div className="account-list">
                  {data.accounts
                    .filter((a) => !a.archived)
                    .map((a) => (
                      <div className="account-row" key={a.id}>
                        <span className="account-symbol" style={{ background: accountColor(a) }}>
                          <AccountIcon type={a.type} />
                        </span>
                        <div className="row-main">
                          <strong>{a.name}</strong>
                          <small className="muted">
                            {{ bank: 'Bank', ewallet: 'E-wallet', cash: 'Tunai' }[a.type]} · awal{' '}
                            {rupiah(a.initial_balance)}
                          </small>
                        </div>
                        <strong className={a.balance < 0 ? 'negative' : ''}>
                          {rupiah(a.balance)}
                        </strong>
                        <div className="row-actions">
                          <button
                            className="btn small"
                            onClick={() => open({ type: 'reconcile', account: a })}
                          >
                            <Scale size={16} />
                            Cocokkan saldo
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Ubah ${a.name}`}
                            onClick={() => open({ type: 'account', account: a })}
                          >
                            <Pencil size={17} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label={`Arsipkan ${a.name}`}
                            onClick={() =>
                              setConfirmation({
                                message: `Arsipkan ${a.name}? Saldo harus Rp0 dan riwayat tetap tersimpan.`,
                                path: `accounts/${a.id}/archive`,
                                method: 'POST',
                                body: { archived: true },
                              })
                            }
                          >
                            <Archive size={17} />
                          </button>
                        </div>
                      </div>
                    ))}
                </div>
              </section>
              {data.accounts.some((a) => a.archived) && (
                <section className="card">
                  <h2>Arsip</h2>
                  {data.accounts
                    .filter((a) => a.archived)
                    .map((a) => (
                      <div className="account-row" key={a.id}>
                        <span className="muted">
                          <Archive size={20} />
                        </span>
                        <strong className="row-main">{a.name}</strong>
                        <span>{rupiah(a.balance)}</span>
                        <button
                          className="btn small"
                          disabled={busy}
                          onClick={() =>
                            run(`accounts/${a.id}/archive`, 'POST', { archived: false })
                          }
                        >
                          Aktifkan lagi
                        </button>
                      </div>
                    ))}
                </section>
              )}
            </>
          )}
          {section === 'categories' && (
            <>
              <section className="card">
                <div className="section-head">
                  <h2>Anggaran bulanan</h2>
                  <Link href="/budgets">Kelola anggaran ↗</Link>
                </div>
                <BudgetPeriod
                  key={data.user.id}
                  month={month}
                  range={budgetRange}
                  onChange={changeBudgetRange}
                >
                  {monthNav}
                </BudgetPeriod>
                {selectedRange && <p className="muted">Periode {periodLabel}</p>}
                <BudgetOverview
                  categories={data.categories}
                  onCreate={() => open({ type: 'budget' })}
                  onEdit={(category) => open({ type: 'budget', category })}
                  busy={busy || loading}
                />
              </section>
              <div className="dashboard-columns">
                {(['expense', 'income'] as const).map((kind) => (
                  <section className="card" key={kind}>
                    <div className="section-head">
                      <h2>Kategori {kind === 'expense' ? 'pengeluaran' : 'pemasukan'}</h2>
                      <Tags size={19} />
                    </div>
                    <div className="category-caption">
                      <span>Seluruh periode</span>
                      {data.categories.some((c) => c.kind === kind && !c.used) && (
                        <span>
                          <MoveLeft size={13} />
                          Geser untuk hapus
                        </span>
                      )}
                    </div>
                    {data.categories
                      .filter((c) => c.kind === kind)
                      .map((c) => (
                        <SwipeCategory
                          key={c.id}
                          name={c.name}
                          canDelete={!c.used}
                          busy={busy}
                          open={openCategory === c.id}
                          onOpenChange={(next) =>
                            setOpenCategory((current) =>
                              next ? c.id : current === c.id ? null : current,
                            )
                          }
                          onDelete={() =>
                            setConfirmation({
                              message: `Hapus kategori ${c.name}?`,
                              path: `categories/${c.id}`,
                              method: 'DELETE',
                            })
                          }
                        >
                          <span className={`tx-icon ${kind}`}>
                            <Tags size={18} />
                          </span>
                          <div className="row-main">
                            <strong>{c.name}</strong>
                            <small className="muted">{c.used} transaksi</small>
                            {kind === 'expense' && (
                              <button
                                className="category-budget-action"
                                disabled={busy || loading}
                                onClick={() => open({ type: 'budget', category: c })}
                              >
                                {c.budget === null
                                  ? 'Atur anggaran'
                                  : `Batas ${rupiah(c.budget)}/bulan`}
                              </button>
                            )}
                          </div>
                          <strong className={kind === 'expense' ? 'negative' : 'positive'}>
                            {c.total ? (kind === 'expense' ? '-' : '+') : ''}
                            {rupiah(c.total)}
                          </strong>
                        </SwipeCategory>
                      ))}
                  </section>
                ))}
              </div>
            </>
          )}
          {section === 'budgets' && (
            <>
              <section className="card">
                <div className="section-head budget-heading">
                  <h2>Pemakaian per kategori</h2>
                </div>
                <BudgetPeriod
                  key={data.user.id}
                  month={month}
                  range={budgetRange}
                  onChange={changeBudgetRange}
                >
                  {monthNav}
                </BudgetPeriod>
                <p className="muted">
                  Pengeluaran {periodLabel} dari semua akun. Sisa anggaran dihitung untuk periode
                  yang dipilih, tanpa membawa sisa periode sebelumnya.
                </p>
                <BudgetOverview
                  categories={data.categories}
                  onCreate={() => open({ type: 'budget' })}
                  onEdit={(category) => open({ type: 'budget', category })}
                  busy={busy || loading}
                />
              </section>
              {data.categories.some((c) => c.kind === 'expense' && c.budget === null) && (
                <section className="card">
                  <div className="section-head">
                    <h2>Kategori tanpa batas</h2>
                  </div>
                  <p className="muted">Pilih kategori yang ingin kamu batasi pengeluarannya.</p>
                  <div className="unbudgeted-list">
                    {data.categories
                      .filter((c) => c.kind === 'expense' && c.budget === null)
                      .map((c) => (
                        <div className="unbudgeted-row" key={c.id}>
                          <div className="row-main">
                            <strong>{c.name}</strong>
                            <small className="muted">
                              Terpakai {rupiah(c.spent)} pada {periodLabel}
                            </small>
                          </div>
                          <button
                            className="btn small"
                            disabled={busy || loading}
                            onClick={() => open({ type: 'budget', category: c })}
                            aria-label={`Atur anggaran ${c.name}`}
                          >
                            <Plus size={16} /> Atur batas
                          </button>
                        </div>
                      ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      )}
      {data && editor && (
        <Modal
          title={
            editor.type === 'transaction'
              ? editor.tx
                ? 'Ubah transaksi'
                : 'Catat transaksi'
              : editor.type === 'account'
                ? editor.account
                  ? 'Ubah akun'
                  : 'Tambah akun'
                : editor.type === 'reconcile'
                  ? `Cocokkan ${editor.account.name}`
                  : editor.type === 'budget'
                    ? 'Atur anggaran'
                    : 'Tambah kategori'
          }
          onClose={() => {
            if (!busy) setEditor(undefined);
          }}
        >
          {error && (
            <p className="flash error" role="alert">
              {error}
            </p>
          )}
          {editor.type === 'transaction' && (
            <TransactionForm
              data={data}
              tx={editor.tx}
              busy={busy}
              onSave={(body) =>
                run(
                  `transactions${editor.tx ? `/${editor.tx.id}` : ''}`,
                  editor.tx ? 'PATCH' : 'POST',
                  body,
                )
              }
              onDelete={() =>
                setConfirmation({
                  message:
                    'Hapus transaksi ini? Biaya admin terkait juga akan dihapus bila ini sebuah transfer.',
                  path: `transactions/${editor.tx!.id}`,
                  method: 'DELETE',
                })
              }
            />
          )}
          {editor.type === 'account' && (
            <AccountForm
              account={editor.account}
              busy={busy}
              onSave={(body) =>
                run(
                  `accounts${editor.account ? `/${editor.account.id}` : ''}`,
                  editor.account ? 'PATCH' : 'POST',
                  body,
                )
              }
            />
          )}
          {editor.type === 'reconcile' && (
            <form
              className="stack"
              onSubmit={async (e) => {
                e.preventDefault();
                await run(
                  `accounts/${editor.account.id}/reconcile`,
                  'POST',
                  Object.fromEntries(new FormData(e.currentTarget)),
                );
              }}
            >
              <div className="reconcile-current">
                <small>Saldo menurut catatan</small>
                <strong>{rupiah(editor.account.balance)}</strong>
              </div>
              <p className="muted">Selisih saldo dicatat sebagai penyesuaian.</p>
              <label>
                Saldo asli sekarang
                <AmountInput name="actual" required />
              </label>
              <button className="btn primary" disabled={busy}>
                Cocokkan saldo
              </button>
            </form>
          )}
          {editor.type === 'category' && (
            <CategoryForm
              busy={busy}
              onSave={(body) => run(`categories?month=${effectiveMonth}`, 'POST', body)}
            />
          )}
          {editor.type === 'budget' && (
            <BudgetForm
              categories={data.categories}
              category={editor.category}
              busy={busy}
              effectiveMonth={effectiveMonth}
              onSave={(body) => run(`budgets?month=${effectiveMonth}`, 'PUT', body)}
            />
          )}
        </Modal>
      )}
      {confirmation && (
        <Modal
          title="Konfirmasi"
          onClose={() => {
            if (!busy) setConfirmation(undefined);
          }}
        >
          <p>{confirmation.message}</p>
          {error && (
            <p className="flash error" role="alert">
              {error}
            </p>
          )}
          <div className="confirm-actions">
            <button className="btn" disabled={busy} onClick={() => setConfirmation(undefined)}>
              Batal
            </button>
            <button
              className="btn danger"
              disabled={busy}
              onClick={() => run(confirmation.path, confirmation.method, confirmation.body ?? {})}
            >
              {busy ? 'Memproses…' : 'Ya, lanjutkan'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
function TransactionList({
  transactions,
  onEdit,
}: {
  transactions: Transaction[];
  onEdit: (tx: Transaction) => void;
}) {
  if (!transactions.length)
    return (
      <div className="empty">
        <Receipt size={34} />
        <strong>Belum ada transaksi</strong>
      </div>
    );
  let previous = '';
  return (
    <div className="transaction-list">
      {transactions.map((tx) => {
        const heading = tx.date !== previous;
        previous = tx.date;
        return (
          <div key={tx.id}>
            {heading && (
              <h3 className="day-heading">
                {tx.date === today()
                  ? 'Hari ini'
                  : new Intl.DateTimeFormat('id-ID', {
                      weekday: 'long',
                      day: 'numeric',
                      month: 'short',
                      year: 'numeric',
                      timeZone: 'UTC',
                    }).format(new Date(tx.date + 'T00:00:00Z'))}
              </h3>
            )}
            <button className="tx-row" onClick={() => onEdit(tx)}>
              <span className={`tx-icon ${tx.kind}`}>
                {tx.kind === 'transfer' ? (
                  <ArrowLeftRight size={19} />
                ) : tx.kind === 'adjustment' ? (
                  <Scale size={19} />
                ) : tx.kind === 'income' ? (
                  <ArrowUpRight size={19} />
                ) : (
                  <ArrowDownLeft size={19} />
                )}
              </span>
              <span className="row-main">
                <strong>
                  {tx.kind === 'transfer'
                    ? `${tx.account_name} → ${tx.to_account_name}`
                    : tx.kind === 'adjustment'
                      ? 'Penyesuaian saldo'
                      : tx.category_name}
                </strong>
                <small className="muted">
                  {tx.note ? `${tx.note} · ` : ''}
                  {tx.account_name}
                  {tx.source === 'gmail' && ' · Otomatis dari Gmail'}
                </small>
              </span>
              <strong
                className={
                  tx.kind === 'expense' || (tx.kind === 'adjustment' && tx.amount < 0)
                    ? 'negative'
                    : tx.kind === 'income' || (tx.kind === 'adjustment' && tx.amount > 0)
                      ? 'positive'
                      : ''
                }
              >
                {tx.kind === 'expense'
                  ? '-'
                  : tx.kind === 'income' || (tx.kind === 'adjustment' && tx.amount > 0)
                    ? '+'
                    : ''}
                {rupiah(tx.amount)}
              </strong>
            </button>
          </div>
        );
      })}
    </div>
  );
}
