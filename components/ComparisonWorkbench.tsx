'use client';
import { useEffect, useRef, useState } from 'react';
import { Alert, Box, Button, Card, CardContent, Chip, Collapse, Grid, LinearProgress, MenuItem, Stack, Table, TableBody, TableCell, TableContainer, TableHead, TableRow, TextField, Typography } from '@mui/material';
import { type Email, type ScoreQuestion } from '@/lib/config';
import { DEFAULT_OPENAI_MODEL, PROVIDERS, PROVIDER_NAMES, PROMPT_VERSION, comparisonCsv, summary, type ComparisonRow, type Evaluation, type Provider } from '@/lib/evaluation';
import { generateExample } from '@/lib/examples';

const percent = (v: number | null) => v === null ? '—' : `${(v * 100).toFixed(1)}%`;
const millis = (v: number | null) => v === null ? '—' : `${v.toLocaleString()} ms`;
type Props = { mode: 'try' | 'dataset'; scoreQuestion: ScoreQuestion | null; onBusy: (busy: boolean) => void };

export default function ComparisonWorkbench({ mode, scoreQuestion, onBusy }: Props) {
  const [keys, setKeys] = useState<Record<Provider, string>>({ jev: '', openai: '' });
  const [model, setModel] = useState(DEFAULT_OPENAI_MODEL);
  const [selection, setSelection] = useState<'both' | Provider>('both');
  const [setup, setSetup] = useState(true);
  const [subject, setSubject] = useState(''); const [body, setBody] = useState('');
  const [count, setCount] = useState(10); const [seed, setSeed] = useState(42);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [rows, setRows] = useState<ComparisonRow[]>([]); const [total, setTotal] = useState(0);
  const [onlyDifferent, setOnlyDifferent] = useState(false);
  const [runInfo, setRunInfo] = useState<Record<string, unknown> | null>(null);
  const [resultMode, setResultMode] = useState<'try' | 'dataset'>('try');
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const active: Provider[] = selection === 'both' ? [...PROVIDERS] : [selection];
  const ready = active.every(p => keys[p].trim()) && !!model.trim();
  const showing = rows.filter(r => !onlyDifferent || (r.outcomes.jev?.result && r.outcomes.openai?.result && r.outcomes.jev.result.label !== r.outcomes.openai.result.label));

  async function run() {
    if (controller.current) return;
    const abort = new AbortController(); controller.current = abort;
    setBusy(true); onBusy(true); setError(''); setRows([]); setTotal(0); setOnlyDifferent(false); setResultMode(mode);
    const metadata = { startedAt: new Date().toISOString(), mode, providers: active, requestedModel: model.trim(), seed: mode === 'dataset' ? seed : null,
      perClass: mode === 'dataset' ? count : null, promptVersion: PROMPT_VERSION, scoreQuestion, bodyLimit: 4000, jevThreshold: .5 };
    setRunInfo(metadata);
    try {
      let emails: Array<{ message_id: number; subject: string; body: string; label?: 'spam' | 'ham' }>;
      if (mode === 'dataset') {
        const res = await fetch(`/api/sample?n=${count}&seed=${seed}`, { signal: abort.signal });
        if (!res.ok) throw new Error('Could not load the dataset.');
        const data = await res.json();
        if (!Array.isArray(data.emails) || !data.emails.length) throw new Error('Dataset sample was empty.');
        emails = data.emails as Email[];
      } else emails = [{ message_id: -1, subject, body }];
      setTotal(emails.length);
      // One email at a time; both providers run concurrently against exactly the same input.
      for (const email of emails) {
        if (abort.signal.aborted) break;
        const row: ComparisonRow = { id: email.message_id, subject: email.subject, truth: email.label, outcomes: {} };
        let fatal = false;
        await Promise.all(active.map(async provider => {
          try {
            const res = await fetch('/api/evaluate', { method: 'POST', signal: abort.signal,
              headers: { 'Content-Type': 'application/json', [provider === 'openai' ? 'x-openai-key' : 'x-typesafe-key']: keys[provider].trim() },
              body: JSON.stringify({ provider, model: model.trim(), subject: email.subject, body: email.body, scoreQuestion }) });
            const data = await res.json();
            if (!res.ok) { if ([400,401,403,429].includes(res.status)) fatal = true; throw new Error(data.error || `HTTP ${res.status}`); }
            row.outcomes[provider] = { result: data as Evaluation };
          } catch (e) {
            row.outcomes[provider] = { error: abort.signal.aborted ? 'Cancelled' : (e as Error).message };
          }
        }));
        setRows(prev => [...prev, row]);
        if (fatal) { setError('Run stopped after an input, authentication, model-access or quota error. Fix the error below before retrying.'); break; }
      }
      if (abort.signal.aborted) setError('Stopped. In-flight requests were cancelled; providers may still charge for work already started.');
    } catch (e) { setError(abort.signal.aborted ? 'Stopped.' : (e as Error).message); }
    finally { controller.current = null; setBusy(false); onBusy(false); }
  }
  function download(format: 'json' | 'csv') {
    const content = format === 'csv' ? comparisonCsv(rows) : JSON.stringify({ ...runInfo, exportedAt: new Date().toISOString(), rows }, null, 2);
    const url = URL.createObjectURL(new Blob([content], { type: format === 'csv' ? 'text/csv' : 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = `email-comparison-${resultMode}.${format}`; a.click(); URL.revokeObjectURL(url);
  }
  return <Stack spacing={2}>
    <Card><CardContent>
      <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center', gap: 1 }}>
        <Box><Typography variant="h6">Compare decision providers</Typography><Typography variant="body2" color="text.secondary">Same email. Same rubric. Independently measured results.</Typography></Box>
        <Button onClick={() => setSetup(!setup)}>{setup ? 'Hide setup' : 'Provider setup'}</Button>
      </Stack>
      <Collapse in={setup}><Stack spacing={2} sx={{ mt: 2 }}>
        <Alert severity="info">OpenAI uses the documented Responses API with Structured Outputs. Decisions API is not connected. OpenAI returns labels and rubric levels here, not calibrated probabilities.</Alert>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}><TextField select fullWidth label="Providers" value={selection} disabled={busy} onChange={e => setSelection(e.target.value as typeof selection)}>
            <MenuItem value="both">JEV + OpenAI</MenuItem><MenuItem value="jev">JEV only</MenuItem><MenuItem value="openai">OpenAI only</MenuItem>
          </TextField></Grid>
          <Grid size={{ xs: 12, md: 4 }}><TextField fullWidth label="OpenAI model" value={model} disabled={busy || selection === 'jev'} onChange={e => setModel(e.target.value)} helperText="A model supporting Responses and Structured Outputs" /></Grid>
          {active.map(p => <Grid size={{ xs: 12, md: 6 }} key={p}><TextField fullWidth label={`${PROVIDER_NAMES[p]} API key`} type="password" autoComplete="off" value={keys[p]} disabled={busy} onChange={e => setKeys(k => ({ ...k, [p]: e.target.value }))} /></Grid>)}
        </Grid>
        <Typography variant="caption" color="text.secondary">Keys stay in memory for this comparison view and pass through this app’s server to the selected provider only. Each selected provider receives the email. Keys are excluded from exports. Reloading clears them.</Typography>
      </Stack></Collapse>
    </CardContent></Card>
    <Card><CardContent><Stack spacing={2}>
      {mode === 'try' ? <>
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'space-between', alignItems: 'center' }}><Typography variant="subtitle1">Try the same email</Typography><Button disabled={busy} onClick={() => { const e = generateExample(); setSubject(e.subject); setBody(e.body); }}>Generate example</Button></Stack>
        <TextField label="Email subject" value={subject} disabled={busy} onChange={e => setSubject(e.target.value)} slotProps={{ htmlInput: { maxLength: 1000 } }} />
        <TextField label="Email body" value={body} disabled={busy} onChange={e => setBody(e.target.value)} multiline minRows={4} maxRows={12} />
      </> : <>
        <Typography variant="subtitle1">Matched Enron-Spam sample</Typography>
        <Stack direction="row" sx={{ gap: 2, flexWrap: 'wrap' }}>
          <TextField label="Emails per class" type="number" value={count} disabled={busy} onChange={e => setCount(Math.max(1, Math.min(100, Math.floor(Number(e.target.value) || 1))))} sx={{ width: 160 }} />
          <TextField label="Comparison seed" type="number" value={seed} disabled={busy} onChange={e => setSeed(Math.trunc(Number(e.target.value) || 0))} sx={{ width: 160 }} />
        </Stack>
        <Typography variant="body2" color="text.secondary">{count * 2} emails × {active.length} provider{active.length > 1 ? 's' : ''} = up to {count * 2 * active.length} paid API calls. Spam/ham has ground truth; category and rubric scores do not.</Typography>
      </>}
      <Typography variant="caption" color="text.secondary">Both providers receive the first 4,000 body characters. {scoreQuestion ? `Scoring: ${scoreQuestion.name}, ${scoreQuestion.criteria.length} levels (edit in Settings).` : 'Rubric scoring is off.'}</Typography>
      <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap' }}>
        {!busy ? <Button variant="contained" disabled={!ready || (mode === 'try' && !subject.trim() && !body.trim())} onClick={run}>{mode === 'try' ? 'Classify email' : 'Run comparison'}</Button> : <Button color="error" variant="outlined" onClick={() => controller.current?.abort()}>Stop comparison</Button>}
        {rows.length > 0 && !busy && <><Button onClick={() => download('json')}>Export JSON</Button><Button onClick={() => download('csv')}>Export CSV</Button></>}
      </Stack>
      {!ready && <Typography variant="caption" color="text.secondary">Add a key for each selected provider to start.</Typography>}
      {total > 0 && <Box><LinearProgress variant="determinate" value={rows.length / total * 100} /><Typography variant="caption">{rows.length} / {total} emails processed{busy ? ' · running' : ''}</Typography></Box>}
      {error && <Alert severity="warning">{error}</Alert>}
    </Stack></CardContent></Card>
    {rows.length > 0 && <>
      <Grid container spacing={2}>{PROVIDERS.filter(p => rows.some(r => r.outcomes[p])).map(p => {
        const s = summary(rows, p);
        return <Grid size={{ xs: 12, md: 6 }} key={p}><Card sx={{ height: '100%' }}><CardContent>
          <Typography variant="h6">{PROVIDER_NAMES[p]}</Typography>
          <Typography variant="caption" color="text.secondary" sx={{ overflowWrap: 'anywhere' }}>{rows.find(r => r.outcomes[p]?.result)?.outcomes[p]?.result?.model ?? 'No successful response'}</Typography>
          <Stack direction="row" sx={{ gap: 1, flexWrap: 'wrap', my: 2 }}><Chip label={`${s.successes} succeeded`} color="success" variant="outlined" /><Chip label={`${s.failures} failed`} color={s.failures ? 'warning' : 'default'} variant="outlined" /></Stack>
          {resultMode === 'dataset' && <>
            <Typography variant="h4">{percent(s.accuracy)}</Typography><Typography variant="body2" color="text.secondary">Spam accuracy · {s.paired} matched successful emails</Typography>
            <Typography variant="body2" sx={{ mt: 1 }}>Precision {percent(s.precision)} · Recall {percent(s.recall)} · F1 {percent(s.f1)}</Typography>
            <Typography variant="body2">False positives {s.fp} · False negatives {s.fn}</Typography>
          </>}
          <Typography variant="body2" sx={{ mt: 2 }}>Latency p50 {millis(s.p50)} · p95 {millis(s.p95)}</Typography>
          <Typography variant="caption" color="text.secondary">Server-to-provider round trip, including response parsing; successful calls only.</Typography>
          <Typography variant="body2" sx={{ mt: 1 }}>Reported tokens: {s.inputTokens ?? '—'} input / {s.outputTokens ?? '—'} output</Typography>
          <Typography variant="caption" color="text.secondary">Token totals cover successful parsed results, not a billing estimate.</Typography>
        </CardContent></Card></Grid>;
      })}</Grid>
      {resultMode === 'dataset' && <Alert severity="info">Accuracy, precision, recall and F1 use only the intersection of successful JEV and OpenAI results. Run both providers to populate them. JEV uses a fixed 0.5 spam threshold; OpenAI uses its returned label. Missing metrics are shown as —.</Alert>}
      <Card><CardContent>
        <Stack direction="row" sx={{ gap: 1, justifyContent: 'space-between', alignItems: 'center', mb: 1 }}><Typography variant="h6">Email results</Typography><Button onClick={() => setOnlyDifferent(!onlyDifferent)}>{onlyDifferent ? 'Show all' : 'Spam disagreements'}</Button></Stack>
        <Typography variant="caption" color="text.secondary" sx={{ display: { xs: "block", md: "none" }, mb: 1 }}>Swipe the table sideways to compare both providers.</Typography>
        <TableContainer><Table size="small" aria-label="Provider comparison results"><TableHead><TableRow><TableCell>Email / truth</TableCell><TableCell>JEV</TableCell><TableCell>OpenAI</TableCell></TableRow></TableHead><TableBody>
          {showing.map(r => <TableRow key={r.id}><TableCell sx={{ minWidth: 160, maxWidth: 280, overflowWrap: 'anywhere' }}><Typography variant="body2">{r.subject || '(no subject)'}</Typography><Typography variant="caption" color="text.secondary">{r.truth ? `True label: ${r.truth}` : 'No ground-truth label'}</Typography></TableCell>
            {PROVIDERS.map(p => { const o = r.outcomes[p], v = o?.result; return <TableCell key={p} sx={{ minWidth: 180, maxWidth: 320, overflowWrap: 'anywhere', verticalAlign: 'top' }}>
              {v ? <Stack spacing={.5}><Chip size="small" label={v.label} color={v.label === 'spam' ? 'warning' : 'info'} sx={{ alignSelf: 'flex-start' }} /><Typography variant="body2">{v.category.replaceAll('_', ' ')}</Typography>
                <Typography variant="caption">Spam probability: {percent(v.spamProbability)}{p === 'openai' ? ' (not returned)' : ''}</Typography>
                {v.score !== null && <Typography variant="caption">{v.scoreName}: {v.score.toFixed(p === 'jev' ? 2 : 0)} / {v.scoreLevels.length - 1}{p === 'jev' ? ' (fractional score)' : ' (selected level)'}</Typography>}
                <Typography variant="caption" color="text.secondary">{millis(v.latencyMs)}</Typography></Stack> : <Typography variant="body2" color={o?.error ? 'error' : 'text.secondary'}>{o?.error ?? 'Not selected'}</Typography>}
            </TableCell>; })}</TableRow>)}
          {!showing.length && <TableRow><TableCell colSpan={3}>No spam-label disagreements among successful pairs.</TableCell></TableRow>}
        </TableBody></Table></TableContainer>
        <Typography variant="caption" color="text.secondary" component="p" sx={{ mt: 2 }}>JEV probabilities are provider-reported, not validated as calibrated by this demo. OpenAI rubric levels and JEV fractional scores have different meanings.</Typography>
      </CardContent></Card>
    </>}
  </Stack>;
}
