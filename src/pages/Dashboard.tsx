import { useState, useEffect } from 'react'
import { Activity, Sun, Moon, BrainCircuit, Upload } from 'lucide-react'
import TransactionTable from '@/components/TransactionTable/TransactionTable'
import ReviewQueue from '@/components/ReviewQueue/ReviewQueue'
import RiskFactorModal from '@/components/RiskFactorModal/RiskFactorModal'
import UploadDialog from '@/components/FileUpload/UploadDialog'
import { useGetTransactionsQuery, useGenerateRiskSummaryMutation } from '@/features/transactions/transactionsApi'
import { selectQueueCount, addManyToQueue } from '@/features/reviewQueue/reviewQueueSlice'
import { useAppSelector, useAppDispatch } from '@/app/hooks'
import { useLocale } from '@/contexts/LocaleContext'
import type { Transaction } from '@/types/transaction'

export default function Dashboard() {
  const [selectedTransaction, setSelectedTransaction] = useState<Transaction | null>(null)
  const [isDark, setIsDark] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState<{ done: number; total: number } | null>(null)
  const [uploadOpen, setUploadOpen] = useState(false)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const queueCount = useAppSelector(selectQueueCount)
  const { data: transactions, refetch } = useGetTransactionsQuery()
  const [generateRiskSummary] = useGenerateRiskSummaryMutation()
  const { locale, setLocale, t } = useLocale()
  const dispatch = useAppDispatch()

  useEffect(() => {
    document.documentElement.classList.toggle('dark', isDark)
  }, [isDark])

  const flaggedCount = transactions?.filter((tx) => tx.status === 'flagged').length ?? 0
  const riskyTransactions = transactions?.filter((tx) => tx.risk_score >= 70) ?? []
  const hasTransactions = !!(transactions && transactions.length > 0)

  function handleUploadFile(file: File) {
    setPendingFile(file)
    setUploadOpen(true)
  }

  function enqueueAllRisky() {
    dispatch(addManyToQueue(riskyTransactions))
  }

  async function analyzeAll(ids?: string[]) {
    const targets = (ids ?? transactions?.map((tx) => tx.id) ?? [])
      .filter((id) => {
        const tx = transactions?.find((t) => t.id === id)
        return !tx || tx.risk_score === 0
      })
    if (targets.length === 0 || analyzeProgress) return
    const CONCURRENCY = 10
    let done = 0
    setAnalyzeProgress({ done: 0, total: targets.length })
    for (let i = 0; i < targets.length; i += CONCURRENCY) {
      const batch = targets.slice(i, i + CONCURRENCY)
      await Promise.allSettled(batch.map((id) => generateRiskSummary(id)))
      done += batch.length
      setAnalyzeProgress({ done, total: targets.length })
    }
    setAnalyzeProgress(null)
    refetch()
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Top Nav */}
      <header className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-screen-xl items-center justify-between px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary">
              <Activity className="h-4 w-4 text-primary-foreground" />
            </div>
            <span className="font-bold tracking-tight">Pulse</span>
          </div>

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {flaggedCount > 0 && (
              <span className="hidden sm:flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-red-500 animate-pulse" />
                {flaggedCount} {t('flagged')}
              </span>
            )}
            {queueCount > 0 && (
              <span className="hidden sm:flex items-center gap-1.5">
                <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                {queueCount} {t('inQueue')}
              </span>
            )}
            {/* Language switcher */}
            <div className="flex items-center gap-1 rounded-md border p-0.5">
              <button
                onClick={() => setLocale('cs-CZ')}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${locale === 'cs-CZ'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground'
                  }`}
              >
                🇨🇿 CZ
              </button>
              <button
                onClick={() => setLocale('pl-PL')}
                className={`rounded px-2 py-0.5 text-xs font-medium transition-colors ${locale === 'pl-PL'
                  ? 'bg-primary text-primary-foreground'
                  : 'hover:bg-muted text-muted-foreground'
                  }`}
              >
                🇵🇱 PL
              </button>
            </div>
            {/* Upload CSV/XLSX — only shown when there are transactions */}
            {hasTransactions && (
              <button
                onClick={() => setUploadOpen(true)}
                className="flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-xs font-medium text-muted-foreground hover:bg-muted transition-colors"
                title={t('uploadButton')}
              >
                <Upload className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{t('uploadButton')}</span>
              </button>
            )}
            {/* Theme toggle */}
            <button
              onClick={() => setIsDark((d) => !d)}
              className="rounded-md border p-1.5 text-muted-foreground hover:bg-muted transition-colors"
              title={isDark ? t('lightMode') : t('darkMode')}
            >
              {isDark ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </header>

      {/* Main Layout */}
      <div className="mx-auto max-w-screen-xl px-4 sm:px-6 py-4 sm:py-6">
        <div className="flex flex-col lg:flex-row gap-6">
          {/* Main Content */}
          <main className="min-w-0 flex-1 space-y-4">
            <div>
              <h1 className="text-xl font-bold">{t('transactionsTitle')}</h1>
              <p className="text-sm text-muted-foreground">
                {t('transactionsSubtitle')}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 w-full">
              <span className="text-xs text-muted-foreground shrink-0">
                {riskyTransactions.length} {t('highRisk')}
              </span>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                <button
                  onClick={() => analyzeAll()}
                  disabled={!!analyzeProgress}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-primary text-primary hover:bg-primary hover:text-primary-foreground transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  <BrainCircuit className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">
                    {analyzeProgress
                      ? `${t('analyzing')} ${analyzeProgress.done}/${analyzeProgress.total}`
                      : t('analyzeAll')}
                  </span>
                  {analyzeProgress && (
                    <span className="sm:hidden">{analyzeProgress.done}/{analyzeProgress.total}</span>
                  )}
                </button>
                <button
                  onClick={enqueueAllRisky}
                  disabled={riskyTransactions.length === 0}
                  className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-md border border-red-500 text-red-500 hover:bg-red-500 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span className="hidden sm:inline">{t('enqueueAllRisky')}</span>
                  <span className="sm:hidden">⚑</span>
                </button>
              </div>
            </div>
            <TransactionTable
              onSelectTransaction={setSelectedTransaction}
              onUploadFile={handleUploadFile}
            />
          </main>

          {/* Sidebar */}
          <div className="w-full lg:w-72 lg:shrink-0">
            <div className="lg:sticky lg:top-20 max-h-[60vh] lg:max-h-[60vh] overflow-hidden flex flex-col">
              <ReviewQueue
                onSelectTransaction={setSelectedTransaction}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Modal */}
      <RiskFactorModal
        transaction={selectedTransaction}
        open={selectedTransaction !== null}
        onClose={() => setSelectedTransaction(null)}
      />

      {/* Upload Dialog */}
      <UploadDialog
        open={uploadOpen}
        onClose={() => { setUploadOpen(false); setPendingFile(null) }}
        onUploadComplete={() => { setUploadOpen(false); setPendingFile(null); refetch() }}
        initialFile={pendingFile}
      />

      {/* Footer */}
      <footer className="border-t mt-auto">
        <div className="mx-auto max-w-screen-xl px-6 py-4 flex items-center justify-between text-xs text-muted-foreground">
          <span>{t('footerText')}</span>
          <span className="flex items-center gap-1.5">
            <Activity className="h-3 w-3" />
            Pulse
          </span>
        </div>
      </footer>
    </div>
  )
}
