import { useState, useCallback, useEffect } from 'react'
import { useDropzone } from 'react-dropzone'
import { Upload, FileSpreadsheet, CheckCircle2, AlertCircle, X, ChevronRight } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useToast } from '@/hooks/use-toast'
import { parseFile } from '@/lib/fileParser'
import { validateFile, sanitizeRow, type TargetField } from '@/lib/csvSanitizer'
import {
  useNormalizeHeadersMutation,
  useResolveUserEmailsMutation,
  useBulkInsertTransactionsMutation,
  useGenerateRiskSummaryMutation,
  useUpsertCreditLimitsMutation,
} from '@/features/transactions/transactionsApi'
import { useLocale } from '@/contexts/LocaleContext'

const BATCH_SIZE = 50
const TARGET_FIELD_LABELS: Record<TargetField, string> = {
  amount: 'Amount',
  currency: 'Currency',
  merchant_name: 'Merchant Name',
  user_identifier: 'User Email / Identifier',
  credit_limit: 'Credit Limit (optional)',
}
const REQUIRED_FIELDS: TargetField[] = ['amount', 'currency', 'merchant_name', 'user_identifier']
const TARGET_FIELDS: TargetField[] = [...REQUIRED_FIELDS, 'credit_limit']

type Step = 'drop' | 'mapping' | 'preview' | 'uploading' | 'done'

interface ParsedState {
  headers: string[]
  rows: Record<string, string>[]
  fileName: string
}

interface MappingState {
  mappings: Record<string, TargetField | null>
}

interface UploadDialogProps {
  open: boolean
  onClose: () => void
  onUploadComplete: (newIds: string[]) => void
  initialFile?: File | null
}

export default function UploadDialog({ open, onClose, onUploadComplete, initialFile }: UploadDialogProps) {
  const { t } = useLocale()
  const { toast } = useToast()

  const [step, setStep] = useState<Step>('drop')
  const [parsed, setParsed] = useState<ParsedState | null>(null)
  const [mapping, setMapping] = useState<MappingState | null>(null)
  const [fileError, setFileError] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null)
  const [uploadedIds, setUploadedIds] = useState<string[]>([])
  const [analysisProgress, setAnalysisProgress] = useState<{ done: number; total: number } | null>(null)

  const [normalizeHeaders] = useNormalizeHeadersMutation()
  const [resolveEmails] = useResolveUserEmailsMutation()
  const [bulkInsert] = useBulkInsertTransactionsMutation()
  const [generateRiskSummary] = useGenerateRiskSummaryMutation()
  const [upsertCreditLimits] = useUpsertCreditLimitsMutation()

  function reset() {
    setStep('drop')
    setParsed(null)
    setMapping(null)
    setFileError(null)
    setUploadProgress(null)
    setUploadedIds([])
    setAnalysisProgress(null)
  }

  function handleClose() {
    reset()
    onClose()
  }

  // ─── Step 1: Drop zone ───────────────────────────────────────────────────
  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const file = acceptedFiles[0]
    if (!file) return

    setFileError(null)

    const typeError = validateFile(file)
    if (typeError) {
      setFileError(typeError.message)
      return
    }

    try {
      const result = await parseFile(file)

      const rowCountError = validateFile(file, result.rows.length)
      if (rowCountError) {
        setFileError(rowCountError.message)
        return
      }

      setParsed({ headers: result.headers, rows: result.rows, fileName: file.name })

      // Kick off AI header normalization immediately
      const { data } = await normalizeHeaders({ headers: result.headers }).unwrap()
        .then((d) => ({ data: d, error: null }))
        .catch((e) => ({ data: null, error: e }))

      const initialMappings: Record<string, TargetField | null> = {}
      for (const h of result.headers) {
        initialMappings[h] = data?.mappings?.[h] ?? null
      }
      setMapping({ mappings: initialMappings })
      setStep('mapping')
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse file'
      setFileError(msg)
    }
  }, [normalizeHeaders])

  // Auto-process a file that was dropped on the table before the dialog opened
  useEffect(() => {
    if (open && initialFile && step === 'drop') {
      onDrop([initialFile])
    }
  }, [open, initialFile]) // eslint-disable-line react-hooks/exhaustive-deps

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'text/csv': ['.csv'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
    },
    maxFiles: 1,
    multiple: false,
  })

  // ─── Step 2: Mapping adjustments ────────────────────────────────────────
  function updateMapping(header: string, value: TargetField | null) {
    if (!mapping) return
    // If another header already uses this target, clear it first
    const newMappings = { ...mapping.mappings }
    if (value !== null) {
      for (const [k, v] of Object.entries(newMappings)) {
        if (v === value && k !== header) {
          newMappings[k] = null
        }
      }
    }
    newMappings[header] = value
    setMapping({ mappings: newMappings })
  }

  function mappingIsComplete() {
    if (!mapping) return false
    return REQUIRED_FIELDS.every((f) =>
      Object.values(mapping.mappings).includes(f)
    )
  }

  // ─── Step 3: Preview ─────────────────────────────────────────────────────
  const previewRows = parsed?.rows.slice(0, 10) ?? []
  const validatedPreview = mapping
    ? previewRows.map((row) => sanitizeRow(row, mapping.mappings as Record<string, TargetField>))
    : []
  // Only show credit_limit column in preview if it was actually mapped
  const previewFields = TARGET_FIELDS.filter(
    (f) => f !== 'credit_limit' || Object.values(mapping?.mappings ?? {}).includes('credit_limit'),
  )

  // ─── Step 4: Upload ──────────────────────────────────────────────────────
  async function handleUpload() {
    if (!parsed || !mapping) return
    setStep('uploading')

    const allMappings = mapping.mappings as Record<string, TargetField>

    // 1. Sanitize + validate all rows
    const validRows = parsed.rows
      .map((row) => sanitizeRow(row, allMappings))
      .filter((r) => r.valid)

    if (validRows.length === 0) {
      toast({ title: t('uploadNoValidRows'), description: t('uploadNoValidRowsDesc'), variant: 'destructive' })
      setStep('preview')
      return
    }

    // 2. Collect unique identifiers and resolve to UUIDs
    const identifiers = [...new Set(validRows.map((r) => r.sanitized.user_identifier.toLowerCase()))]
    let resolutions: Record<string, string> = {}
    try {
      const result = await resolveEmails({ identifiers })
      resolutions = result.data?.resolutions ?? {}
    } catch {
      toast({ title: t('uploadResolveFailed'), variant: 'destructive' })
      setStep('preview')
      return
    }

    // 3. If credit_limit was mapped, upsert limits for each unique user
    const creditLimitMapped = Object.entries(allMappings).find(([, v]) => v === 'credit_limit')?.[0]
    const identifierColName = Object.entries(allMappings).find(([, v]) => v === 'user_identifier')?.[0]
    if (creditLimitMapped && identifierColName) {
      const emailToLimit: Record<string, number> = {}
      for (const row of parsed.rows) {
        const email = row[identifierColName]?.toLowerCase()
        const limit = parseFloat(row[creditLimitMapped])
        if (email && !isNaN(limit) && limit > 0) emailToLimit[email] = limit
      }
      const limitUpserts = Object.entries(emailToLimit)
        .map(([email, creditLimit]) => ({ userId: resolutions[email], creditLimit }))
        .filter((x) => !!x.userId)
      if (limitUpserts.length > 0) {
        try {
          await upsertCreditLimits(limitUpserts)
        } catch {
          // Non-fatal — credit limits are best-effort
        }
      }
    }

    // 4. Build DB payloads — every email now resolves (auto-created if new)
    const dbRows = validRows.map((r) => ({
      amount: parseFloat(r.sanitized.amount),
      currency: r.sanitized.currency.toUpperCase(),
      merchant_name: r.sanitized.merchant_name,
      user_id: resolutions[r.sanitized.user_identifier.toLowerCase()],
      status: 'pending' as const,
      risk_score: 0 as const,
      risk_factors: [] as never[],
    }))

    if (dbRows.length === 0) {
      toast({ title: t('uploadNoValidRows'), description: t('uploadNoValidRowsDesc'), variant: 'destructive' })
      setStep('preview')
      return
    }

    // 4. Batch insert
    const allInserted: string[] = []
    setUploadProgress({ done: 0, total: dbRows.length })
    for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
      const batch = dbRows.slice(i, i + BATCH_SIZE)
      try {
        const inserted = await bulkInsert(batch).unwrap() as { id: string }[]
        allInserted.push(...inserted.map((r) => r.id))
      } catch {
        toast({ title: t('uploadBatchFailed'), description: `Batch ${Math.ceil(i / BATCH_SIZE) + 1} failed`, variant: 'destructive' })
      }
      setUploadProgress({ done: Math.min(i + BATCH_SIZE, dbRows.length), total: dbRows.length })
    }

    setUploadedIds(allInserted)

    // 5. Auto-trigger AI risk analysis in parallel batches
    const ANALYSIS_CONCURRENCY = 10
    let analysisDone = 0
    setAnalysisProgress({ done: 0, total: allInserted.length })
    for (let i = 0; i < allInserted.length; i += ANALYSIS_CONCURRENCY) {
      const batch = allInserted.slice(i, i + ANALYSIS_CONCURRENCY)
      await Promise.allSettled(batch.map((id) => generateRiskSummary(id)))
      analysisDone += batch.length
      setAnalysisProgress({ done: analysisDone, total: allInserted.length })
    }
    setAnalysisProgress(null)

    onUploadComplete(allInserted)
    setStep('done')
  }

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{t('uploadTitle')}</DialogTitle>
          <DialogDescription>{t('uploadDesc')}</DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-2">
          {(['drop', 'mapping', 'preview', 'uploading', 'done'] as Step[]).map((s, idx) => (
            <span key={s} className="flex items-center gap-1">
              <span className={`font-medium ${step === s ? 'text-primary' : ''}`}>
                {idx + 1}
              </span>
              {idx < 4 && <ChevronRight className="h-3 w-3" />}
            </span>
          ))}
          <span className="ml-2 capitalize">{t(`uploadStep_${step}` as Parameters<typeof t>[0])}</span>
        </div>

        {/* ── Step 1: Drop zone ── */}
        {step === 'drop' && (
          <div className="space-y-3">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-10 text-center cursor-pointer transition-colors
                ${isDragActive ? 'border-primary bg-primary/5' : 'border-muted-foreground/30 hover:border-primary/60 hover:bg-muted/30'}`}
            >
              <input {...getInputProps()} />
              <Upload className="mx-auto mb-3 h-8 w-8 text-muted-foreground" />
              <p className="text-sm font-medium">
                {isDragActive ? t('uploadDropHere') : t('uploadDragOrClick')}
              </p>
              <p className="text-xs text-muted-foreground mt-1">{t('uploadFileHint')}</p>
            </div>
            {fileError && (
              <div className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                {fileError}
              </div>
            )}
          </div>
        )}

        {/* ── Step 2: Column mapping ── */}
        {step === 'mapping' && mapping && parsed && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              <FileSpreadsheet className="inline h-4 w-4 mr-1 -mt-0.5" />
              <strong>{parsed.fileName}</strong> — {parsed.rows.length.toLocaleString()} {t('uploadRows')}
            </p>
            <div className="rounded-md border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium">{t('uploadColHeader')}</th>
                    <th className="px-3 py-2 text-left font-medium">{t('uploadColMapsTo')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {parsed.headers.map((header) => (
                    <tr key={header}>
                      <td className="px-3 py-2 font-mono text-xs">{header}</td>
                      <td className="px-3 py-2">
                        <select
                          value={mapping.mappings[header] ?? ''}
                          onChange={(e) => updateMapping(header, (e.target.value || null) as TargetField | null)}
                          className="w-full rounded-md border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                        >
                          <option value="">{t('uploadIgnore')}</option>
                          {TARGET_FIELDS.map((f) => (
                            <option key={f} value={f}>{TARGET_FIELD_LABELS[f]}</option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!mappingIsComplete() && (
              <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                <AlertCircle className="h-3.5 w-3.5 shrink-0" />
                {t('uploadMappingIncomplete')}
              </div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={reset}>{t('uploadBack')}</Button>
              <Button size="sm" onClick={() => setStep('preview')} disabled={!mappingIsComplete()}>
                {t('uploadPreview')}
              </Button>
            </div>
          </div>
        )}

        {/* ── Step 3: Preview ── */}
        {step === 'preview' && parsed && mapping && (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t('uploadPreviewDesc')}</p>
            <div className="rounded-md border overflow-auto max-h-64">
              <table className="w-full text-xs">
                <thead className="bg-muted sticky top-0">
                  <tr>
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">#</th>
                    {previewFields.map((f) => (
                      <th key={f} className="px-2 py-1.5 text-left font-medium text-muted-foreground">
                        {TARGET_FIELD_LABELS[f]}
                      </th>
                    ))}
                    <th className="px-2 py-1.5 text-left font-medium text-muted-foreground">{t('uploadStatus')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {validatedPreview.map((row, i) => (
                    <tr key={i} className={row.valid ? '' : 'bg-destructive/5'}>
                      <td className="px-2 py-1.5 text-muted-foreground">{i + 1}</td>
                      {previewFields.map((f) => (
                        <td key={f} className="px-2 py-1.5 max-w-[120px] truncate">
                          {row.sanitized[f] || <span className="text-muted-foreground/50">—</span>}
                        </td>
                      ))}
                      <td className="px-2 py-1.5">
                        {row.valid ? (
                          <span className="text-green-600 dark:text-green-400 flex items-center gap-1">
                            <CheckCircle2 className="h-3 w-3" /> {t('uploadValid')}
                          </span>
                        ) : (
                          <span className="text-destructive flex items-center gap-1" title={row.errors.join('; ')}>
                            <X className="h-3 w-3" /> {row.errors[0]}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted-foreground">
              {validatedPreview.filter((r) => !r.valid).length > 0
                ? `${validatedPreview.filter((r) => !r.valid).length} ${t('uploadInvalidRows')}`
                : t('uploadAllValid')}
              {' · '}{t('uploadTotalRows').replace('{0}', String(parsed.rows.length))}
            </p>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setStep('mapping')}>{t('uploadBack')}</Button>
              <Button size="sm" onClick={handleUpload}>{t('uploadConfirm')}</Button>
            </div>
          </div>
        )}

        {/* ── Step 4: Uploading ── */}
        {step === 'uploading' && (
          <div className="space-y-4 py-4">
            {uploadProgress && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('uploadInserting')}</span>
                  <span>{uploadProgress.done}/{uploadProgress.total}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300"
                    style={{ width: `${(uploadProgress.done / uploadProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
            {analysisProgress && (
              <div className="space-y-1.5">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{t('uploadAnalyzing')}</span>
                  <span>{analysisProgress.done}/{analysisProgress.total}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-amber-500 transition-all duration-300"
                    style={{ width: `${(analysisProgress.done / analysisProgress.total) * 100}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Step 5: Done ── */}
        {step === 'done' && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-green-500" />
            <div>
              <p className="font-semibold">{t('uploadDoneTitle')}</p>
              <p className="text-sm text-muted-foreground mt-1">
                {t('uploadDoneDesc').replace('{0}', String(uploadedIds.length))}
              </p>
            </div>
            <Button onClick={handleClose}>{t('uploadClose')}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
