'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useLogger } from '@/hooks/useLogger';
import { Navbar } from '@/components/Navbar';
import { ConsoleLog } from '@/components/ConsoleLog';
import { SpaceInput } from '@/components/SpaceInput';
import { ContentTypeSelect } from '@/components/ContentTypeSelect';
import { ContentTypePicker } from '@/components/ContentTypePicker';
import { TransformConfig, type TransformState } from '@/components/TransformConfig';
import { AnalysisPanel } from '@/components/AnalysisPanel';
import { MigrateResultPanel } from '@/components/MigrateResultPanel';
import { TransformResultPanel } from '@/components/TransformResultPanel';
import {
  runAnalyze, runExtract, runCreate, runMigrate, runTransform, runFixBrokenAssets,
  type AnalysisResult, type ExtractionResult, type MigrateResult, type TransformResult, type FixBrokenAssetsResult,
} from '@/lib/operations';
import { getCurrentUser } from '@/lib/contentful-client';
import { useRouter } from 'next/navigation';

type Mode = 'extract-create' | 'migrate' | 'transform';
type Step =
  | 'configure'
  | 'analyzing' | 'analyzed'
  | 'extracting' | 'extracted'
  | 'creating' | 'executing'
  | 'done';

const MODES: { key: Mode; label: string; icon: string; desc: string }[] = [
  { key: 'extract-create', label: 'Extract & Create', icon: '↓↑', desc: 'Extract entries from source, preview them, then create in target.' },
  { key: 'migrate',        label: 'Direct Migrate',   icon: '⇄',  desc: 'Walk source tree and create entries in target in one step.' },
  { key: 'transform',      label: 'Transform',        icon: '✎',  desc: 'Bulk update fields on existing entries in a space.' },
];

export default function DashboardPage() {
  const { token, user, isAuthenticated, loading: authLoading } = useAuth();
  const { logger, entries, subscribe, clear, download } = useLogger();
  const router = useRouter();

  const [mode, setMode] = useState<Mode>('extract-create');

  // --- Space config (shared, always at top) ---
  const [srcSpace, setSrcSpace] = useState('');
  const [srcEnv, setSrcEnv] = useState('dev');
  const [tgtSpace, setTgtSpace] = useState('');
  const [tgtEnv, setTgtEnv] = useState('master');

  // --- Tree config (extract-create & migrate) ---
  const [entryId, setEntryId] = useState('');
  const [depth, setDepth] = useState(1);
  const [skipTypes, setSkipTypes] = useState<string[]>([]);
  const [publish, setPublish] = useState(false);

  // --- Transform config ---
  const [transformState, setTransformState] = useState<TransformState>({
    preset: 'fix-broken-assets', contentType: '', draftOnly: false, publishedOnly: false, updatedByMe: false,
    nameContains: '', replacementEntryId: '',
    rule: 'set', field: '', targetLocale: 'en', sourceLocale: 'en', value: '', isJsonValue: false,
  });
  const [fixResult, setFixResult] = useState<FixBrokenAssetsResult | null>(null);

  // --- Execution state ---
  const [step, setStep] = useState<Step>('configure');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [extraction, setExtraction] = useState<ExtractionResult | null>(null);
  const [migrateResult, setMigrateResult] = useState<MigrateResult | null>(null);
  const [transformResult, setTransformResult] = useState<TransformResult | null>(null);

  useEffect(() => { const unsub = subscribe(); return unsub; }, [subscribe]);

  if (authLoading) return <div className="min-h-screen flex items-center justify-center text-muted animate-pulse">Loading...</div>;
  if (!isAuthenticated) { router.push('/'); return null; }

  const reset = () => {
    setStep('configure');
    setAnalysis(null);
    setExtraction(null);
    setMigrateResult(null);
    setTransformResult(null);
    setFixResult(null);
    setPublish(false);
  };

  const switchMode = (m: Mode) => { setMode(m); reset(); clear(); };

  const busy = ['analyzing', 'extracting', 'creating', 'executing'].includes(step);
  const isTree = mode === 'extract-create' || mode === 'migrate';
  const needsTarget = mode === 'migrate' || mode === 'extract-create';

  // ---- Actions ----

  const handleAnalyze = async () => {
    if (!token || !srcSpace || !entryId) return;
    setStep('analyzing'); setAnalysis(null); clear();
    try {
      const res = await runAnalyze(token, srcSpace, srcEnv, entryId, { maxDepth: depth, skipTypes }, logger);
      setAnalysis(res);
      setStep('analyzed');
    } catch (err: unknown) {
      logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
      setStep('configure');
    }
  };

  const handleExtract = async () => {
    if (!token || !srcSpace || !entryId) return;
    setStep('extracting'); setExtraction(null); clear();
    try {
      const res = await runExtract(token, srcSpace, srcEnv, entryId, { maxDepth: depth, skipTypes }, logger);
      setExtraction(res);
      setStep('extracted');
    } catch (err: unknown) {
      logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
      setStep('analyzed');
    }
  };

  const handleCreate = async () => {
    if (!token || !extraction || !tgtSpace) return;
    setStep('creating'); clear();
    try {
      const res = await runCreate(token, extraction, { spaceId: tgtSpace, envId: tgtEnv }, { publish }, logger);
      setMigrateResult(res);
      setStep('done');
    } catch (err: unknown) {
      logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
      setStep('extracted');
    }
  };

  const handleMigrate = async () => {
    if (!token || !srcSpace || !tgtSpace || !entryId) return;
    setStep('executing'); clear();
    try {
      const res = await runMigrate(
        token,
        { spaceId: srcSpace, envId: srcEnv, entryId },
        { spaceId: tgtSpace, envId: tgtEnv },
        { maxDepth: depth, skipTypes, publish },
        logger,
      );
      setMigrateResult(res);
      setStep('done');
    } catch (err: unknown) {
      logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
      setStep('analyzed');
    }
  };

  const resolveFilters = async () => {
    const ts = transformState;
    const filters: { draft?: boolean; published?: boolean; updatedBy?: string; nameContains?: string } = {};
    if (ts.draftOnly) filters.draft = true;
    if (ts.publishedOnly) filters.published = true;
    if (ts.updatedByMe && token) {
      const u = await getCurrentUser(token);
      filters.updatedBy = u.id;
      logger.info(`Resolved "me" → ${u.id}`);
    }
    if (ts.nameContains.trim()) filters.nameContains = ts.nameContains.trim();
    return filters;
  };

  const handleTransform = async () => {
    const ts = transformState;
    if (!token || !tgtSpace || !ts.contentType) return;
    setStep('executing'); clear();
    try {
      const filters = await resolveFilters();

      if (ts.preset === 'fix-broken-assets') {
        if (!ts.replacementEntryId) { logger.error('Replacement Entry ID is required.'); setStep('configure'); return; }
        const res = await runFixBrokenAssets(token, tgtSpace, tgtEnv, ts.contentType, ts.replacementEntryId, filters, logger);
        setFixResult(res);
        setStep('done');
      } else {
        let parsedValue: unknown = ts.value;
        if (ts.isJsonValue) {
          try { parsedValue = JSON.parse(ts.value); } catch { logger.error('Invalid JSON value.'); setStep('configure'); return; }
        }
        const transform = {
          rule: ts.rule, field: ts.field || undefined, targetLocale: ts.targetLocale,
          sourceLocale: ts.rule === 'copy' ? ts.sourceLocale : undefined,
          value: ts.rule === 'set' ? parsedValue : undefined,
        };
        const res = await runTransform(token, tgtSpace, tgtEnv, ts.contentType, [transform], filters, logger);
        setTransformResult(res);
        setStep('done');
      }
    } catch (err: unknown) {
      logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
      setStep('configure');
    }
  };

  // ---- Steps for indicator ----
  const stepDefs = mode === 'extract-create'
    ? [
        { key: 'configure', label: 'Configure' },
        { key: 'analyze',   label: 'Analyze' },
        { key: 'extract',   label: 'Extract' },
        { key: 'create',    label: 'Create' },
      ]
    : mode === 'migrate'
      ? [
          { key: 'configure', label: 'Configure' },
          { key: 'analyze',   label: 'Analyze' },
          { key: 'migrate',   label: 'Migrate' },
        ]
      : [
          { key: 'configure', label: 'Configure' },
          { key: 'execute',   label: 'Execute' },
        ];

  const stepIndex = mode === 'extract-create'
    ? step === 'configure' ? 0
      : step === 'analyzing' || step === 'analyzed' ? 1
      : step === 'extracting' || step === 'extracted' ? 2
      : step === 'creating' || step === 'done' ? 3 : 0
    : mode === 'migrate'
      ? step === 'configure' ? 0
        : step === 'analyzing' || step === 'analyzed' ? 1
        : step === 'executing' || step === 'done' ? 2 : 0
      : step === 'configure' ? 0
        : step === 'executing' || step === 'done' ? 1 : 0;

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="flex-1 max-w-5xl mx-auto w-full px-6 py-8 space-y-5">

        {/* ─── Header ─── */}
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-bold">Workspace</h1>
            <p className="text-xs text-muted mt-0.5">
              {user?.firstName} {user?.lastName} &middot; {user?.email}
            </p>
          </div>
          <StepBar steps={stepDefs} activeIndex={stepIndex} doneIndex={step === 'done' ? stepDefs.length : stepIndex} />
        </div>

        {/* ─── Mode tabs ─── */}
        <div className="flex border-b border-border">
          {MODES.map(m => (
            <button key={m.key} onClick={() => switchMode(m.key)} disabled={busy}
              className={`px-5 py-2.5 text-sm font-medium border-b-2 transition-colors -mb-px ${
                mode === m.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-foreground'
              } disabled:opacity-50`}>
              <span className="mr-1.5">{m.icon}</span>{m.label}
            </button>
          ))}
        </div>
        <p className="text-xs text-muted">{MODES.find(m => m.key === mode)!.desc}</p>

        {/* ─── Spaces (always visible at top) ─── */}
        <Section title="Spaces">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {isTree && (
              <SpaceInput label="Source Space" spaceId={srcSpace} envId={srcEnv} onSpaceChange={setSrcSpace} onEnvChange={setSrcEnv} />
            )}
            {(needsTarget || mode === 'transform') && (
              <SpaceInput label="Target Space" spaceId={tgtSpace} envId={tgtEnv} onSpaceChange={setTgtSpace} onEnvChange={setTgtEnv} />
            )}
          </div>
        </Section>

        {/* ─── Operation config ─── */}
        {isTree && (
          <Section title="Entry Tree Options">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-muted">Entry ID</label>
                <input type="text" value={entryId} onChange={e => setEntryId(e.target.value)} placeholder="e.g. 4HmRxJk2OikYAU72YeTKEv" className="w-full" />
              </div>
              <div className="space-y-1.5">
                <label className="block text-xs font-semibold text-muted">Max Depth</label>
                <select value={depth} onChange={e => setDepth(Number(e.target.value))} className="w-full">
                  {[0, 1, 2, 3, 5, 10].map(d => (
                    <option key={d} value={d}>{d === 0 ? '0 (root only)' : d}</option>
                  ))}
                </select>
              </div>
              <ContentTypeSelect token={token || ''} spaceId={srcSpace} envId={srcEnv} selected={skipTypes} onChange={setSkipTypes} label="Skip Types" />
            </div>
            {needsTarget && (
              <label className="flex items-center gap-2 text-sm mt-4">
                <input type="checkbox" checked={publish} onChange={e => setPublish(e.target.checked)} className="w-4 h-4 rounded" />
                Auto-publish entries after creation
              </label>
            )}
          </Section>
        )}

        {mode === 'transform' && (
          <Section title="Transform Options">
            <div className="space-y-5">
              <ContentTypePicker token={token || ''} spaceId={tgtSpace} envId={tgtEnv}
                value={transformState.contentType}
                onChange={v => setTransformState({ ...transformState, contentType: v })}
                label="Content Type" />
              <TransformConfig state={transformState} onChange={setTransformState} />
            </div>
          </Section>
        )}

        {/* ─── Actions ─── */}
        <div className="flex items-center gap-3 pt-1">
          {isTree && step === 'configure' && (
            <ActionBtn onClick={handleAnalyze} disabled={!srcSpace || !entryId || busy} variant="secondary">
              Analyze
            </ActionBtn>
          )}
          {isTree && step === 'analyzing' && (
            <ActionBtn disabled loading variant="secondary">Analyzing...</ActionBtn>
          )}

          {/* After analysis: show proceed button */}
          {isTree && step === 'analyzed' && mode === 'extract-create' && (
            <ActionBtn onClick={handleExtract} disabled={busy} variant="primary">Extract</ActionBtn>
          )}
          {isTree && step === 'analyzed' && mode === 'migrate' && (
            <ActionBtn onClick={handleMigrate} disabled={!tgtSpace || busy} variant="primary">Migrate</ActionBtn>
          )}

          {/* After extraction: create */}
          {mode === 'extract-create' && step === 'extracted' && (
            <ActionBtn onClick={handleCreate} disabled={!tgtSpace || busy} variant="primary">Create in Target</ActionBtn>
          )}

          {/* Busy states for execution */}
          {step === 'extracting' && <ActionBtn disabled loading variant="primary">Extracting...</ActionBtn>}
          {step === 'creating' && <ActionBtn disabled loading variant="primary">Creating...</ActionBtn>}
          {step === 'executing' && mode === 'migrate' && <ActionBtn disabled loading variant="primary">Migrating...</ActionBtn>}

          {/* Transform execute */}
          {mode === 'transform' && step === 'configure' && (
            <ActionBtn onClick={handleTransform}
              disabled={!tgtSpace || !transformState.contentType || busy ||
                (transformState.preset === 'fix-broken-assets' && !transformState.replacementEntryId)}
              variant="primary">
              {transformState.preset === 'fix-broken-assets' ? 'Fix Broken Assets' : 'Run Transform'}
            </ActionBtn>
          )}
          {mode === 'transform' && step === 'executing' && (
            <ActionBtn disabled loading variant="primary">Transforming...</ActionBtn>
          )}

          {/* Re-analyze / reset */}
          {step !== 'configure' && !busy && (
            <>
              {isTree && step !== 'done' && (
                <ActionBtn onClick={handleAnalyze} disabled={!srcSpace || !entryId} variant="ghost">Re-analyze</ActionBtn>
              )}
              <ActionBtn onClick={() => { reset(); clear(); }} variant="ghost">Reset</ActionBtn>
            </>
          )}
        </div>

        {/* ─── Analysis panel ─── */}
        {analysis && (step === 'analyzed' || step === 'extracting' || step === 'extracted' || step === 'creating' || (step === 'done' && mode !== 'transform')) && (
          <AnalysisPanel analysis={analysis} onProceed={() => {}} proceedLabel="" busy={busy} hideButton />
        )}

        {/* ─── Extraction summary (extract-create mode, after extract) ─── */}
        {extraction && (step === 'extracted' || step === 'creating' || (step === 'done' && mode === 'extract-create')) && (
          <div className="bg-card p-5 rounded-xl border border-border space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold">Extracted: {extraction.rootTitle}</h3>
              {step === 'extracted' && (
                <span className="text-xs px-2 py-0.5 bg-primary/20 text-primary rounded-full">Ready to create</span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Stat label="Entries" value={extraction.dependencyOrder.length} cls="text-primary" />
              <Stat label="Assets" value={extraction.assetIds.length} cls="text-warning" />
              <Stat label="Types" value={new Set(Object.values(extraction.entries).map(e => e.contentType)).size} cls="text-success" />
            </div>
          </div>
        )}

        {/* ─── Create / Migrate result ─── */}
        {migrateResult && step === 'done' && (mode === 'migrate' || mode === 'extract-create') && (
          <MigrateResultPanel result={migrateResult} />
        )}

        {/* ─── Transform result ─── */}
        {transformResult && step === 'done' && mode === 'transform' && transformState.preset === 'custom-rule' && (
          <TransformResultPanel result={transformResult} />
        )}

        {/* ─── Fix broken assets result ─── */}
        {fixResult && step === 'done' && mode === 'transform' && transformState.preset === 'fix-broken-assets' && (
          <div className="bg-card p-5 rounded-xl border border-border">
            <h3 className="text-sm font-semibold mb-3">Fix Broken Assets Complete</h3>
            <div className="grid grid-cols-4 gap-3 text-sm">
              <Stat label="Checked" value={fixResult.checked} cls="text-foreground" />
              <Stat label="Fixed" value={fixResult.fixed} cls="text-success" />
              <Stat label="OK" value={fixResult.skipped} cls="text-muted" />
              <Stat label="Failed" value={fixResult.failed} cls="text-error" />
            </div>
          </div>
        )}

        {/* ─── Console ─── */}
        <ConsoleLog entries={entries} onDownload={download} onClear={clear} />
      </main>
    </div>
  );
}

// ─── Shared sub-components ───────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border border-border overflow-hidden">
      <div className="px-5 py-2.5 border-b border-border bg-card-hover/30">
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  );
}

function StepBar({ steps, activeIndex, doneIndex }: { steps: { key: string; label: string }[]; activeIndex: number; doneIndex: number }) {
  return (
    <div className="flex items-center gap-1 text-xs">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-1">
          <span className={`px-2 py-0.5 rounded-full font-medium whitespace-nowrap ${
            i < doneIndex && i < activeIndex ? 'bg-success/20 text-success'
              : i === activeIndex ? 'bg-primary/20 text-primary'
              : 'bg-card text-muted'
          }`}>
            {i < activeIndex ? '✓ ' : `${i + 1}. `}{s.label}
          </span>
          {i < steps.length - 1 && <span className="text-border">→</span>}
        </div>
      ))}
    </div>
  );
}

function ActionBtn({ children, onClick, disabled, loading, variant }: {
  children: React.ReactNode; onClick?: () => void; disabled?: boolean; loading?: boolean;
  variant: 'primary' | 'secondary' | 'ghost';
}) {
  const base = 'px-5 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed';
  const styles = {
    primary: 'bg-primary hover:bg-primary-hover text-white',
    secondary: 'bg-card hover:bg-card-hover border border-border text-foreground',
    ghost: 'text-muted hover:text-foreground',
  };
  return (
    <button onClick={onClick} disabled={disabled || loading} className={`${base} ${styles[variant]}`}>
      {loading && <span className="inline-block w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin mr-2 align-middle" />}
      {children}
    </button>
  );
}

function Stat({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="bg-background rounded-lg p-3 text-center">
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
      <div className="text-muted text-xs">{label}</div>
    </div>
  );
}
