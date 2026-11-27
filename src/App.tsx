import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { startRegistration } from '@simplewebauthn/browser';
import type { PublicKeyCredentialCreationOptionsJSON } from '@simplewebauthn/browser';
import { registerSW } from 'virtual:pwa-register';
import {
  AlertTriangle,
  BarChart3,
  BellRing,
  Building2,
  CheckCircle2,
  ClipboardList,
  Clock,
  Cloud,
  FileText,
  Fingerprint,
  HardHat,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Menu,
  Plus,
  Receipt,
  RefreshCw,
  Settings,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';
import {
  api,
  clearAuthToken,
  flushPendingMutations,
  isAppsScriptRuntime,
  OfflineQueuedError,
  setAuthToken,
  setOnSessionRevoked,
} from './services/apiClient';
import { isPlatformAuthenticatorAvailable, isWebAuthnSupported } from './services/deviceIdentity';
import {
  clearPrimaryDriveMemorySession,
  getPrimaryDriveMemorySession,
  syncSnapshotToPrimaryDrive,
} from './services/primaryDriveClient';
import { disconnectSecondaryGoogleDrive } from './services/secondaryDriveClient';
import {
  AdminBootstrapPayload,
  AppScreen,
  AuthUser,
  BuildingProfile,
  CustomerProfile,
  MoneyReceiptRecord,
  OrderRecord,
  QuotationRecord,
  QuotationStatus,
  SupervisorJobView,
} from './types/order';
import { getTodayDhakaIso } from './utils/dateAndPhone';
import { generateWhatsAppDraft, WhatsAppTemplateType } from './utils/whatsappTemplates';
import { AuthGate } from './components/AuthGate';
import { BrandLogo } from './components/BrandLogo';
import { ChangePasswordModal } from './components/ChangePasswordModal';
import { CompleteOrderModal } from './components/CompleteOrderModal';
import { CustomersView } from './components/CustomersView';
import { DashboardView } from './components/DashboardView';
import { DeviceUnlockScreen } from './components/DeviceUnlockScreen';
import { DocumentPreviewModal } from './components/DocumentPreviewModal';
import { EnrolledDevicesPanel } from './components/EnrolledDevicesPanel';
import { FollowupsView, FollowupTab } from './components/FollowupsView';
import { LeadsView } from './components/LeadsView';
import { OfflineIndicator } from './components/OfflineIndicator';
import { OrderDetailView } from './components/OrderDetailView';
import {
  OrderBuildingPrefill,
  OrderFormModal,
  OrderLeadPrefill,
} from './components/OrderFormModal';
import { OrdersFilterState, OrdersView } from './components/OrdersView';
import { PWAInstallButton } from './components/PWAInstallButton';
import { QuotationLeadPrefill, QuotationsView } from './components/QuotationsView';
import { ReceiptsView } from './components/ReceiptsView';
import { ReportsView } from './components/ReportsView';
import { RescheduleFollowupModal } from './components/RescheduleFollowupModal';
import { SettingsTab, SettingsView } from './components/SettingsView';
import { SupervisorJobsView } from './components/SupervisorJobsView';
import { SupervisorsView } from './components/SupervisorsView';
import {
  WhatsAppPreviewModal,
  WhatsAppPreviewRequest,
} from './components/WhatsAppPreviewModal';
import { WorkersView } from './components/WorkersView';

const DEFAULT_ORDER_FILTERS: OrdersFilterState = {
  query: '',
  status: '',
  service: '',
  date: '',
  supervisorId: '',
  preset: '',
};

interface ToastState {
  message: string;
  tone: 'success' | 'error';
}

export function App() {
  const [authLoading, setAuthLoading] = useState(true);
  const [needsAdminSetup, setNeedsAdminSetup] = useState(false);
  const [adminSetupLocked, setAdminSetupLocked] = useState(false);
  const [initialAdminUsername, setInitialAdminUsername] = useState('scc@gmail.com');
  const [envAdminConfigured, setEnvAdminConfigured] = useState(false);
  const [googleAdminEnabled, setGoogleAdminEnabled] = useState(false);
  const [ownerEmailHint, setOwnerEmailHint] = useState('');
  const [backendMode, setBackendMode] = useState<'apps_script' | 'local_preview'>('local_preview');
  const [backendReachable, setBackendReachable] = useState(true);
  const [backendStatusMessage, setBackendStatusMessage] = useState('');
  const [publicLogoUrl, setPublicLogoUrl] = useState('');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [lockedPreview, setLockedPreview] = useState<{
    id: string;
    name: string;
    username: string;
    role: 'admin' | 'supervisor';
  } | null>(null);
  const [deviceUnlockEnrolled, setDeviceUnlockEnrolled] = useState(false);
  const [showEnrollBanner, setShowEnrollBanner] = useState(false);
  const [enrollingBanner, setEnrollingBanner] = useState(false);
  const [changePassOpen, setChangePassOpen] = useState(false);
  const [supDevicesModalOpen, setSupDevicesModalOpen] = useState(false);

  // Admin state
  const [bootstrap, setBootstrap] = useState<AdminBootstrapPayload | null>(null);
  const [loadingBootstrap, setLoadingBootstrap] = useState(false);
  const [screen, setScreen] = useState<AppScreen>('dashboard');
  const [settingsInitialTab, setSettingsInitialTab] = useState<SettingsTab>('general');
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const autoSyncInFlightRef = useRef(false);

  // Filter / Tab states
  const [ordersFilters, setOrdersFilters] = useState<OrdersFilterState>(DEFAULT_ORDER_FILTERS);
  const [followupTab, setFollowupTab] = useState<FollowupTab>('today');
  const [quotationsInitialFilter, setQuotationsInitialFilter] = useState<
    'all' | 'due_followups' | QuotationStatus
  >('all');
  const [preselectReceiptOrderId, setPreselectReceiptOrderId] = useState('');

  // Prefill & Modal states
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [orderModalMode, setOrderModalMode] = useState<'create' | 'edit' | 'rebook'>('create');
  const [orderModalSource, setOrderModalSource] = useState<OrderRecord | null>(null);
  const [orderLeadPrefill, setOrderLeadPrefill] = useState<OrderLeadPrefill | null>(null);
  const [orderBuildingPrefill, setOrderBuildingPrefill] = useState<OrderBuildingPrefill | null>(
    null
  );
  const [quotationLeadPrefill, setQuotationLeadPrefill] = useState<QuotationLeadPrefill | null>(
    null
  );
  const [completeTarget, setCompleteTarget] = useState<OrderRecord | null>(null);
  const [rescheduleTarget, setRescheduleTarget] = useState<OrderRecord | null>(null);
  const [previewReceiptFromDetail, setPreviewReceiptFromDetail] =
    useState<MoneyReceiptRecord | null>(null);
  const [whatsAppRequest, setWhatsAppRequest] = useState<WhatsAppPreviewRequest | null>(null);

  // Supervisor state
  const [supToday, setSupToday] = useState(getTodayDhakaIso());
  const [supEndDate, setSupEndDate] = useState(getTodayDhakaIso());
  const [supJobs, setSupJobs] = useState<SupervisorJobView[]>([]);
  const [supLogo, setSupLogo] = useState('');
  const [loadingSup, setLoadingSup] = useState(false);

  // Toast
  const [toast, setToast] = useState<ToastState | null>(null);

  const notify = useCallback((message: string, tone: 'success' | 'error' = 'success') => {
    setToast({ message, tone });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4200);
    return () => clearTimeout(t);
  }, [toast]);

  // Register PWA Service Worker (when served outside Google Apps Script HTML Service)
  useEffect(() => {
    if (isAppsScriptRuntime()) return;
    try {
      registerSW({
        immediate: true,
        onOfflineReady() {
          // Offline app shell cached cleanly
        },
      });
    } catch {
      // Ignore SW registration issues in restricted environments
    }
  }, []);

  const loadAdminBootstrap = useCallback(async () => {
    setLoadingBootstrap(true);
    try {
      const data = await api.getAdminBootstrap();
      setBootstrap(data);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load workspace data.', 'error');
    } finally {
      setLoadingBootstrap(false);
    }
  }, [notify]);

  const loadSupervisorJobs = useCallback(async () => {
    setLoadingSup(true);
    try {
      const data = await api.getSupervisorJobs();
      setSupToday(data.todayDhaka);
      setSupEndDate(data.endDateDhaka);
      setSupJobs(data.jobs);
      setSupLogo(data.companyLogoDataUrl || '');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Failed to load assigned jobs.', 'error');
    } finally {
      setLoadingSup(false);
    }
  }, [notify]);

  const loadAuthStatusAndResume = useCallback(async () => {
    setAuthLoading(true);
    try {
      const [st, resumed] = await Promise.all([
        api.getAuthStatus(),
        api.resumeSession().catch(() => ({ status: 'unauthenticated' as const })),
      ]);
      setNeedsAdminSetup(st.needsAdminSetup);
      setAdminSetupLocked(Boolean(st.adminSetupLocked));
      setInitialAdminUsername(st.initialAdminUsername || 'scc@gmail.com');
      setEnvAdminConfigured(Boolean(st.envAdminConfigured));
      setGoogleAdminEnabled(Boolean(st.googleAdminEnabled && st.ownerEmailHint));
      setOwnerEmailHint(st.ownerEmailHint || '');
      setBackendMode(st.backendMode || 'local_preview');
      setBackendReachable(st.backendReachable !== false);
      setBackendStatusMessage(st.backendStatusMessage || '');
      setPublicLogoUrl(st.companyLogoDataUrl || '');

      if (resumed.status === 'locked' && resumed.userPreview) {
        setLockedPreview(resumed.userPreview);
        setDeviceUnlockEnrolled(true);
        setUser(null);
      } else if (resumed.status === 'authenticated' && resumed.token && resumed.user) {
        setAuthToken(resumed.token);
        setUser(resumed.user);
        setLockedPreview(null);
        setDeviceUnlockEnrolled(Boolean(resumed.deviceUnlockAvailable));
        if (resumed.user.role === 'admin') {
          setScreen('dashboard');
          loadAdminBootstrap();
        } else {
          loadSupervisorJobs();
        }
      } else {
        setLockedPreview(null);
      }
    } catch {
      setBackendReachable(false);
      setBackendStatusMessage(
        'Unable to reach the backend service. Please verify the server or Apps Script deployment is running and try again.'
      );
    } finally {
      setAuthLoading(false);
    }
  }, [loadAdminBootstrap, loadSupervisorJobs]);

  useEffect(() => {
    loadAuthStatusAndResume();
  }, [loadAuthStatusAndResume]);

  useEffect(() => {
    setOnSessionRevoked((reason) => {
      setUser(null);
      setLockedPreview(null);
      setBootstrap(null);
      setSupJobs([]);
      setShowEnrollBanner(false);
      notify(reason || 'Your session expired or was revoked. Please sign in again.', 'error');
    });
    return () => setOnSessionRevoked(null);
  }, [notify]);

  // Auto-replay queued offline mutations when connection returns
  useEffect(() => {
    if (!user) return;
    const handleOnline = async () => {
      const res = await flushPendingMutations();
      if (res.syncedCount > 0) {
        notify(
          `Reconnected: synced ${res.syncedCount} queued mobile change${
            res.syncedCount === 1 ? '' : 's'
          } without duplicates.`,
          'success'
        );
        if (user.role === 'admin') {
          loadAdminBootstrap();
        } else {
          loadSupervisorJobs();
        }
      }
    };
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [user, loadAdminBootstrap, loadSupervisorJobs, notify]);

  // Automatic debounced Primary Google Drive background sync (Admin-only, only when authorized in browser)
  const pendingPrimarySyncRev =
    user?.role === 'admin' &&
    bootstrap?.settings.primary_drive_sync_status === 'pending_sync' &&
    bootstrap?.settings.primary_drive_email
      ? bootstrap.settings.sync_revision
      : 0;

  useEffect(() => {
    if (isAppsScriptRuntime()) return;
    if (!pendingPrimarySyncRev || !bootstrap) return;
    if (!getPrimaryDriveMemorySession().connected) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;

    const timer = setTimeout(async () => {
      if (autoSyncInFlightRef.current) return;
      autoSyncInFlightRef.current = true;
      try {
        const { snapshot } = await api.getPrimaryDriveSnapshot();
        const result = await syncSnapshotToPrimaryDrive({
          snapshot,
          expectedBaseRevision: bootstrap.settings.primary_drive_last_synced_revision || 0,
        });
        if (result.status === 'conflict') {
          const failed = await api.reportPrimaryDriveFailure(
            `Sync conflict: Primary Drive has newer revision v${result.remoteRevision}. Open Settings → Google Drive to resolve.`
          );
          setBootstrap(failed.bootstrap);
        } else if (result.status === 'saved' && result.fileId) {
          const confirmed = await api.confirmPrimaryDriveSync({
            revision: result.revision || Number(snapshot.sync_revision || 1),
            file_id: result.fileId,
            checksum_sha256: result.checksumSha256 || String(snapshot.integrity_sha256 || ''),
            email: result.email || bootstrap.settings.primary_drive_email,
          });
          setBootstrap(confirmed.bootstrap);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Primary Drive auto-sync failed.';
        try {
          const reported = await api.reportPrimaryDriveFailure(msg);
          setBootstrap(reported.bootstrap);
        } catch {
          // Ignore secondary report error
        }
      } finally {
        autoSyncInFlightRef.current = false;
      }
    }, 1500);

    return () => clearTimeout(timer);
  }, [pendingPrimarySyncRev, bootstrap]);

  const handleAuthenticated = (authUser: AuthUser, isDeviceEnrolled = false) => {
    setUser(authUser);
    setLockedPreview(null);
    setDeviceUnlockEnrolled(isDeviceEnrolled);
    setShowEnrollBanner(!isDeviceEnrolled && !isAppsScriptRuntime() && isWebAuthnSupported());
    if (authUser.role === 'admin') {
      setScreen('dashboard');
      loadAdminBootstrap();
    } else {
      loadSupervisorJobs();
    }
  };

  const handleQuickEnableDeviceUnlock = async () => {
    setEnrollingBanner(true);
    try {
      const preferPlatform = await isPlatformAuthenticatorAvailable();
      const opts = await api.webAuthnRegisterOptions(preferPlatform);
      const attestation = await startRegistration({
        optionsJSON: opts.options as PublicKeyCredentialCreationOptionsJSON,
      });
      const verified = await api.webAuthnRegisterVerify({
        challengeId: opts.challengeId,
        response: attestation,
      });
      setDeviceUnlockEnrolled(true);
      setShowEnrollBanner(false);
      notify(verified.message || 'Device Unlock enabled on this phone.', 'success');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Device Unlock setup was cancelled.';
      notify(msg, 'error');
    } finally {
      setEnrollingBanner(false);
    }
  };

  const handleLockApp = () => {
    if (!user || !deviceUnlockEnrolled) return;
    clearAuthToken();
    setLockedPreview({
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
    });
    setUser(null);
    setBootstrap(null);
    setSupJobs([]);
  };

  const handleLogout = async () => {
    try {
      await api.logout();
    } catch {
      // Clear local state regardless of network status
    }
    clearAuthToken();
    clearPrimaryDriveMemorySession();
    disconnectSecondaryGoogleDrive().catch(() => undefined);
    setUser(null);
    setLockedPreview(null);
    setDeviceUnlockEnrolled(false);
    setShowEnrollBanner(false);
    setBootstrap(null);
    setSupJobs([]);
    setSelectedOrderId(null);
    setScreen('dashboard');
    loadAuthStatusAndResume();
  };

  const openOrderDetail = (orderId: string) => {
    setSelectedOrderId(orderId);
    setScreen('detail');
    setMobileMenuOpen(false);
  };

  const openNewOrderModal = () => {
    setOrderModalMode('create');
    setOrderModalSource(null);
    setOrderLeadPrefill(null);
    setOrderBuildingPrefill(null);
    setOrderModalOpen(true);
  };

  const openEditOrderModal = (order: OrderRecord) => {
    setOrderModalMode('edit');
    setOrderModalSource(order);
    setOrderLeadPrefill(null);
    setOrderBuildingPrefill(null);
    setOrderModalOpen(true);
  };

  const openRebookOrderModal = (order: OrderRecord) => {
    setOrderModalMode('rebook');
    setOrderModalSource(order);
    setOrderLeadPrefill(null);
    setOrderBuildingPrefill(null);
    setOrderModalOpen(true);
  };

  const openBookAgainForBuilding = (
    customer: CustomerProfile,
    building: BuildingProfile,
    lastOrder?: OrderRecord
  ) => {
    setOrderModalMode(lastOrder ? 'rebook' : 'create');
    setOrderModalSource(lastOrder || null);
    setOrderLeadPrefill(null);
    setOrderBuildingPrefill({ customer, building, previousOrder: lastOrder || null });
    setOrderModalOpen(true);
  };

  const openWhatsAppForOrder = (
    order: OrderRecord,
    template: WhatsAppTemplateType = 'booking_confirmed'
  ) => {
    const initialMessage = generateWhatsAppDraft({
      template,
      customerName: order.customer_name,
      phoneDisplay: order.phone_display,
      phoneE164: order.phone_e164,
      service: order.services_text,
      dateIso: template === 'repeat_cleaning_due' ? order.followup_date : order.scheduled_date,
      time24: template === 'repeat_cleaning_due' ? undefined : order.scheduled_time,
      orderId: order.order_id,
      amountBdt: order.price_bdt,
      address: order.address,
    });
    setWhatsAppRequest({
      templateType: template,
      recipientName: order.customer_name,
      phone: order.phone_display,
      initialMessage,
      contextLabel: order.order_id,
    });
  };

  const openWhatsAppForQuotation = (q: QuotationRecord) => {
    const services = (q.items || []).map((i) => i.service).filter(Boolean).join(', ');
    const initialMessage = generateWhatsAppDraft({
      template: 'send_quotation',
      customerName: q.customer_name,
      phoneDisplay: q.phone_display,
      phoneE164: q.phone_e164,
      service: services || 'Water Tank Cleaning Service',
      dateIso: q.quotation_date,
      quotationId: q.quotation_id,
      amountBdt: q.total_bdt,
      quotationShareUrl: q.share_url,
      address: q.address,
    });
    setWhatsAppRequest({
      templateType: 'send_quotation',
      recipientName: q.customer_name,
      phone: q.phone_display,
      initialMessage,
      contextLabel: q.quotation_id,
    });
  };

  const selectedOrder = useMemo(() => {
    if (!bootstrap || !selectedOrderId) return null;
    return bootstrap.orders.find((o) => o.order_id === selectedOrderId) || null;
  }, [bootstrap, selectedOrderId]);

  const selectedOrderBuilding = useMemo(() => {
    if (!bootstrap || !selectedOrder || !selectedOrder.building_id) return null;
    return bootstrap.buildings.find((b) => b.building_id === selectedOrder.building_id) || null;
  }, [bootstrap, selectedOrder]);

  const selectedOrderReceipt = useMemo(() => {
    if (!bootstrap || !selectedOrder) return null;
    return bootstrap.receipts.find((r) => r.order_id === selectedOrder.order_id) || null;
  }, [bootstrap, selectedOrder]);

  const selectedOrderHistory = useMemo(() => {
    if (!bootstrap || !selectedOrder) return [];
    return bootstrap.history.filter((h) => h.order_id === selectedOrder.order_id);
  }, [bootstrap, selectedOrder]);

  const selectedOrderSettlements = useMemo(() => {
    if (!bootstrap || !selectedOrder) return [];
    return bootstrap.settlementEntries.filter((e) => e.order_id === selectedOrder.order_id);
  }, [bootstrap, selectedOrder]);

  const selectedOrderComplaints = useMemo(() => {
    if (!bootstrap || !selectedOrder) return [];
    return bootstrap.complaints.filter((c) => c.order_id === selectedOrder.order_id);
  }, [bootstrap, selectedOrder]);

  const selectedOrderWorkerHistory = useMemo(() => {
    if (!bootstrap || !selectedOrder) return [];
    return bootstrap.workerPaymentHistory.filter((h) => h.order_id === selectedOrder.order_id);
  }, [bootstrap, selectedOrder]);

  // 1. Auth Loading
  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-sm font-medium text-slate-600">
        Loading SUNVILOZ Clean Care...
      </div>
    );
  }

  // 1B. Device Unlock Screen (when persistent mobile session reopens with Device Unlock enrolled)
  if (!user && lockedPreview) {
    return (
      <>
        <DeviceUnlockScreen
          userPreview={lockedPreview}
          companyLogoDataUrl={publicLogoUrl}
          onUnlocked={(unlockedUser) => handleAuthenticated(unlockedUser, true)}
          onUsePasswordFallback={() => setLockedPreview(null)}
          onSignOut={handleLogout}
        />
        {toast && (
          <div
            className={`fixed bottom-4 right-4 z-50 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
              toast.tone === 'error' ? 'bg-red-600' : 'bg-[#0F766E]'
            }`}
          >
            {toast.message}
          </div>
        )}
      </>
    );
  }

  // 2. Auth Gate (Sign In / Locked Admin Setup)
  if (!user) {
    return (
      <>
        <AuthGate
          needsAdminSetup={needsAdminSetup}
          adminSetupLocked={adminSetupLocked}
          initialAdminUsername={initialAdminUsername}
          envAdminConfigured={envAdminConfigured}
          googleAdminEnabled={googleAdminEnabled}
          ownerEmailHint={ownerEmailHint}
          backendMode={backendMode}
          backendReachable={backendReachable}
          backendStatusMessage={backendStatusMessage}
          companyLogoDataUrl={publicLogoUrl}
          onAuthenticated={handleAuthenticated}
        />
        {toast && (
          <div
            className={`fixed bottom-4 right-4 z-50 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
              toast.tone === 'error' ? 'bg-red-600' : 'bg-[#0F766E]'
            }`}
          >
            {toast.message}
          </div>
        )}
      </>
    );
  }

  // 3. Supervisor Restricted Portal (Zero access to Admin / Google Drive / Reports)
  if (user.role === 'supervisor') {
    return (
      <>
        <OfflineIndicator onSynced={loadSupervisorJobs} onNotify={notify} />
        {showEnrollBanner && (
          <div className="border-b border-teal-200 bg-teal-50 px-4 py-2.5 text-xs text-teal-950">
            <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <Fingerprint className="h-4 w-4 shrink-0 text-[#0F766E]" />
                <span>
                  Unlock quickly next time with your phone&apos;s fingerprint, face, or screen lock.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={enrollingBanner}
                  onClick={handleQuickEnableDeviceUnlock}
                  className="rounded-lg bg-[#0F766E] px-3 py-1 font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {enrollingBanner ? 'Enabling...' : 'Enable Device Unlock'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnrollBanner(false)}
                  className="font-semibold text-slate-500 hover:text-slate-700"
                >
                  Not Now
                </button>
              </div>
            </div>
          </div>
        )}
        <SupervisorJobsView
          user={user}
          todayDhaka={supToday}
          endDateDhaka={supEndDate}
          jobs={supJobs}
          companyLogoDataUrl={supLogo}
          loading={loadingSup}
          onRefresh={loadSupervisorJobs}
          onLogout={handleLogout}
          onOpenChangePassword={() => setChangePassOpen(true)}
          onOpenDeviceSecurity={() => setSupDevicesModalOpen(true)}
          onNotify={notify}
          onCompleteJob={async (orderId, payload) => {
            try {
              const res = await api.completeOrderAsSupervisor(orderId, payload);
              notify(res.message || 'Job completion submitted.', 'success');
              await loadSupervisorJobs();
            } catch (err) {
              if (err instanceof OfflineQueuedError) {
                notify(err.message, 'success');
                return;
              }
              throw err;
            }
          }}
        />
        <ChangePasswordModal
          open={changePassOpen}
          user={user}
          onClose={() => setChangePassOpen(false)}
          onSuccess={(msg) => notify(msg, 'success')}
        />
        {supDevicesModalOpen && (
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4"
            role="dialog"
            aria-modal="true"
          >
            <div className="max-h-[90vh] w-full max-w-xl overflow-y-auto rounded-2xl bg-slate-50 p-4 shadow-2xl space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-base font-bold text-[#0B1F3A]">Device Unlock &amp; Sessions</h2>
                <button
                  type="button"
                  onClick={() => setSupDevicesModalOpen(false)}
                  className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-200"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <EnrolledDevicesPanel
                onNotify={notify}
                onEnrollmentChanged={(enrolled) => {
                  setDeviceUnlockEnrolled(enrolled);
                  if (enrolled) setShowEnrollBanner(false);
                }}
                onCurrentSessionRevoked={handleLogout}
              />
            </div>
          </div>
        )}
        {toast && (
          <div
            className={`fixed bottom-4 right-4 z-50 rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-lg ${
              toast.tone === 'error' ? 'bg-red-600' : 'bg-[#0F766E]'
            }`}
          >
            {toast.message}
          </div>
        )}
      </>
    );
  }

  // 4. Admin Workspace Loading
  if (!bootstrap) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-slate-50 p-4 text-sm text-slate-600">
        <RefreshCw className="h-6 w-6 animate-spin text-[#0F766E]" />
        <div>Loading SUNVILOZ Clean Care workspace...</div>
      </div>
    );
  }

  const navItems: Array<{ key: AppScreen; label: string; icon: React.ComponentType<{ className?: string }> }> = [
    { key: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
    { key: 'customers', label: 'Customers', icon: Building2 },
    { key: 'leads', label: 'Prospects', icon: UserPlus },
    { key: 'orders', label: 'Orders', icon: ClipboardList },
    { key: 'quotations', label: 'Quotations', icon: FileText },
    { key: 'receipts', label: 'Money Receipts', icon: Receipt },
    { key: 'followups', label: 'Follow-Ups', icon: BellRing },
    { key: 'supervisors', label: 'Supervisors', icon: UserCheck },
    { key: 'workers', label: 'Workers', icon: HardHat },
    { key: 'reports', label: 'Reports', icon: BarChart3 },
    { key: 'settings', label: 'Settings', icon: Settings },
  ];

  const handleNavSelect = (next: AppScreen) => {
    setScreen(next);
    if (next === 'quotations') {
      setQuotationsInitialFilter('all');
    }
    setMobileMenuOpen(false);
  };

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-900">
      {/* Desktop Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-[#0B1F3A] text-white lg:flex">
        <div className="border-b border-white/10 p-5">
          <BrandLogo
            logoDataUrl={bootstrap.settings.company_logo_data_url}
            variant="dark"
            subtitle="Operations & Accounts"
          />
        </div>

        <div className="p-3">
          <button
            type="button"
            onClick={openNewOrderModal}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#0F766E] px-3 py-2.5 text-sm font-semibold text-white shadow-xs hover:bg-[#118c82]"
          >
            <Plus className="h-4 w-4" />
            New Order
          </button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-1">
          {navItems.map((item) => {
            const Icon = item.icon;
            const active =
              screen === item.key || (screen === 'detail' && item.key === 'orders');
            return (
              <button
                key={item.key}
                type="button"
                onClick={() => handleNavSelect(item.key)}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors ${
                  active
                    ? 'bg-white/15 font-semibold text-white'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="border-t border-white/10 p-4 space-y-2">
          {/* Primary Google Drive Sync Status Badge */}
          <button
            type="button"
            onClick={() => {
              setSettingsInitialTab('google_drive');
              setScreen('settings');
            }}
            className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-semibold transition-colors ${
              bootstrap.settings.primary_drive_sync_status === 'saved_to_primary_drive'
                ? 'border-emerald-400/30 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25'
                : bootstrap.settings.primary_drive_sync_status === 'sync_failed'
                ? 'border-red-400/40 bg-red-500/20 text-red-200 hover:bg-red-500/30'
                : bootstrap.settings.primary_drive_sync_status === 'pending_sync'
                ? 'border-amber-400/40 bg-amber-500/20 text-amber-200 hover:bg-amber-500/30'
                : 'border-white/15 bg-white/5 text-slate-300 hover:bg-white/10'
            }`}
            title="Open Settings → Google Drive"
          >
            <span className="inline-flex items-center gap-1.5 truncate">
              {bootstrap.settings.primary_drive_sync_status === 'saved_to_primary_drive' ? (
                <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
              ) : bootstrap.settings.primary_drive_sync_status === 'sync_failed' ? (
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
              ) : bootstrap.settings.primary_drive_sync_status === 'pending_sync' ? (
                <Clock className="h-3.5 w-3.5 shrink-0" />
              ) : (
                <Cloud className="h-3.5 w-3.5 shrink-0" />
              )}
              <span className="truncate">
                {bootstrap.settings.primary_drive_sync_status === 'saved_to_primary_drive'
                  ? 'Saved to Primary Drive'
                  : bootstrap.settings.primary_drive_sync_status === 'sync_failed'
                  ? 'Sync Failed'
                  : bootstrap.settings.primary_drive_sync_status === 'pending_sync'
                  ? 'Pending Sync'
                  : 'Connect Primary Drive'}
              </span>
            </span>
          </button>

          <PWAInstallButton variant="sidebar" onNotify={notify} />

          <div className="pt-1">
            <div className="truncate text-xs font-semibold text-white">{user.name}</div>
            <div className="truncate text-[11px] text-slate-400">{user.username}</div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setChangePassOpen(true)}
              className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-teal-200 hover:bg-white/15"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Password
            </button>
            {deviceUnlockEnrolled && (
              <button
                type="button"
                onClick={handleLockApp}
                className="flex items-center justify-center gap-1 rounded-lg bg-white/10 px-2 py-1.5 text-[11px] font-semibold text-amber-200 hover:bg-white/15"
                title="Lock App (require Device Unlock)"
              >
                <Lock className="h-3.5 w-3.5" />
                Lock
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={loadAdminBootstrap}
              disabled={loadingBootstrap}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-white/15"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingBootstrap ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <button
              type="button"
              onClick={handleLogout}
              className="flex items-center justify-center gap-1 rounded-lg bg-white/10 px-2.5 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-500/20"
            >
              <LogOut className="h-3.5 w-3.5" />
              Sign Out
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile Top Bar & Drawer */}
      <div className="flex min-w-0 flex-1 flex-col">
        <OfflineIndicator onSynced={loadAdminBootstrap} onNotify={notify} />

        {showEnrollBanner && (
          <div className="border-b border-teal-200 bg-teal-50 px-4 py-2.5 text-xs text-teal-950">
            <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 font-medium">
                <Fingerprint className="h-4 w-4 shrink-0 text-[#0F766E]" />
                <span>
                  Enable <strong>Device Unlock</strong> on this device to reopen SUNVILOZ Clean Care
                  with your fingerprint, face, or screen lock instead of retyping your password.
                </span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={enrollingBanner}
                  onClick={handleQuickEnableDeviceUnlock}
                  className="rounded-lg bg-[#0F766E] px-3 py-1 font-semibold text-white hover:bg-[#0c6059] disabled:opacity-50"
                >
                  {enrollingBanner ? 'Enabling...' : 'Enable Device Unlock'}
                </button>
                <button
                  type="button"
                  onClick={() => setShowEnrollBanner(false)}
                  className="font-semibold text-slate-500 hover:text-slate-700"
                >
                  Not Now
                </button>
              </div>
            </div>
          </div>
        )}

        <header className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 lg:hidden">
          <button
            type="button"
            onClick={() => setMobileMenuOpen(true)}
            className="rounded-lg border border-slate-200 p-2 text-slate-700"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex flex-col items-center">
            <span className="text-sm font-bold text-[#0B1F3A]">SUNVILOZ Clean Care</span>
            <button
              type="button"
              onClick={() => {
                setSettingsInitialTab('google_drive');
                setScreen('settings');
              }}
              className={`text-[10px] font-semibold ${
                bootstrap.settings.primary_drive_sync_status === 'saved_to_primary_drive'
                  ? 'text-emerald-700'
                  : bootstrap.settings.primary_drive_sync_status === 'sync_failed'
                  ? 'text-red-700'
                  : bootstrap.settings.primary_drive_sync_status === 'pending_sync'
                  ? 'text-amber-700'
                  : 'text-slate-500'
              }`}
            >
              {bootstrap.settings.primary_drive_sync_status === 'saved_to_primary_drive'
                ? '● Saved to Primary Drive'
                : bootstrap.settings.primary_drive_sync_status === 'sync_failed'
                ? '● Sync Failed'
                : bootstrap.settings.primary_drive_sync_status === 'pending_sync'
                ? '● Pending Sync'
                : 'Primary Drive Not Connected'}
            </button>
          </div>
          <button
            type="button"
            onClick={openNewOrderModal}
            className="inline-flex items-center gap-1 rounded-lg bg-[#0F766E] px-3 py-1.5 text-xs font-semibold text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            New
          </button>
        </header>

        {mobileMenuOpen && (
          <div className="fixed inset-0 z-50 flex lg:hidden">
            <div
              className="fixed inset-0 bg-slate-900/50"
              onClick={() => setMobileMenuOpen(false)}
            />
            <div className="relative z-10 flex h-full w-72 flex-col bg-[#0B1F3A] text-white shadow-2xl">
              <div className="flex items-center justify-between border-b border-white/10 p-4">
                <BrandLogo
                  logoDataUrl={bootstrap.settings.company_logo_data_url}
                  variant="dark"
                  compact
                />
                <button
                  type="button"
                  onClick={() => setMobileMenuOpen(false)}
                  className="rounded-lg p-1.5 text-slate-300 hover:bg-white/10"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex-1 space-y-1 overflow-y-auto p-3">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const active = screen === item.key;
                  return (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => handleNavSelect(item.key)}
                      className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium ${
                        active ? 'bg-white/15 font-semibold text-white' : 'text-slate-300'
                      }`}
                    >
                      <Icon className="h-4 w-4" />
                      {item.label}
                    </button>
                  );
                })}
              </nav>
              <div className="space-y-2 border-t border-white/10 p-4">
                <PWAInstallButton variant="sidebar" onNotify={notify} />
                {deviceUnlockEnrolled && (
                  <button
                    type="button"
                    onClick={() => {
                      setMobileMenuOpen(false);
                      handleLockApp();
                    }}
                    className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-amber-200"
                  >
                    <Lock className="h-4 w-4" />
                    Lock App
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setMobileMenuOpen(false);
                    setChangePassOpen(true);
                  }}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-teal-200"
                >
                  <KeyRound className="h-4 w-4" />
                  Change Password
                </button>
                <button
                  type="button"
                  onClick={handleLogout}
                  className="flex w-full items-center justify-center gap-2 rounded-lg bg-white/10 px-3 py-2 text-xs font-semibold text-red-200"
                >
                  <LogOut className="h-4 w-4" />
                  Sign Out ({user.name})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Main Content Canvas */}
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">
          {screen === 'dashboard' && (
            <DashboardView
              orders={bootstrap.orders}
              leads={bootstrap.leads}
              quotations={bootstrap.quotations}
              supervisors={bootstrap.supervisors}
              todayDhaka={bootstrap.todayDhaka}
              onSelectOrder={openOrderDetail}
              onNewOrder={openNewOrderModal}
              onNavigateOrdersPreset={(preset) => {
                setOrdersFilters({ ...DEFAULT_ORDER_FILTERS, preset });
                setScreen('orders');
              }}
              onNavigateFollowups={(tab) => {
                setFollowupTab(tab);
                setScreen('followups');
              }}
              onNavigateLeads={() => setScreen('leads')}
              onNavigateQuotationsDue={() => {
                setQuotationsInitialFilter('due_followups');
                setScreen('quotations');
              }}
              onOpenWhatsAppOrder={openWhatsAppForOrder}
              onOpenWhatsAppQuotation={openWhatsAppForQuotation}
              onBookAgainOrder={openRebookOrderModal}
            />
          )}

          {screen === 'customers' && (
            <CustomersView
              customers={bootstrap.customers}
              buildings={bootstrap.buildings}
              orders={bootstrap.orders}
              onCreateCustomer={async (payload) => {
                const res = await api.createCustomer(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Customer created.', 'success');
              }}
              onUpdateCustomer={async (id, payload) => {
                const res = await api.updateCustomer(id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Customer updated.', 'success');
              }}
              onCreateBuilding={async (payload) => {
                const res = await api.createBuilding(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Building profile saved.', 'success');
              }}
              onUpdateBuilding={async (id, payload) => {
                const res = await api.updateBuilding(id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Building profile updated.', 'success');
              }}
              onDeleteBuilding={async (id) => {
                const res = await api.deleteBuilding(id);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Building deleted.', 'success');
              }}
              onOpenOrder={openOrderDetail}
              onBookAgainForBuilding={openBookAgainForBuilding}
            />
          )}

          {screen === 'leads' && (
            <LeadsView
              leads={bootstrap.leads}
              leadNotes={bootstrap.leadNotes}
              todayDhaka={bootstrap.todayDhaka}
              onCreateLead={async (payload) => {
                const res = await api.createLead(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Prospect created.', 'success');
              }}
              onUpdateLead={async (id, payload) => {
                const res = await api.updateLead(id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Prospect updated.', 'success');
              }}
              onAddLeadNote={async (id, payload) => {
                const res = await api.addLeadNote(id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Note added.', 'success');
              }}
              onRescheduleFollowup={async (id, payload) => {
                const res = await api.rescheduleLeadFollowup(id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Follow-up rescheduled.', 'success');
              }}
              onToggleFollowupDone={async (id, payload) => {
                const res = await api.toggleLeadFollowupDone(id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Follow-up status updated.', 'success');
              }}
              onCreateQuotationFromLead={(prefill) => {
                setQuotationLeadPrefill(prefill);
                setScreen('quotations');
              }}
              onCreateOrderFromLead={(prefill) => {
                setOrderModalMode('create');
                setOrderModalSource(null);
                setOrderBuildingPrefill(null);
                setOrderLeadPrefill(prefill);
                setOrderModalOpen(true);
              }}
              onOpenOrder={openOrderDetail}
            />
          )}

          {screen === 'orders' && (
            <OrdersView
              orders={bootstrap.orders}
              supervisors={bootstrap.supervisors}
              todayDhaka={bootstrap.todayDhaka}
              filters={ordersFilters}
              onChangeFilters={setOrdersFilters}
              onSelectOrder={openOrderDetail}
              onOpenWhatsApp={(order) => openWhatsAppForOrder(order, 'booking_confirmed')}
              onNewOrder={openNewOrderModal}
            />
          )}

          {screen === 'detail' && selectedOrder && (
            <OrderDetailView
              order={selectedOrder}
              allOrders={bootstrap.orders}
              building={selectedOrderBuilding}
              history={selectedOrderHistory}
              receipt={selectedOrderReceipt}
              supervisors={bootstrap.supervisors}
              workers={bootstrap.workers}
              settlementEntries={selectedOrderSettlements}
              complaints={selectedOrderComplaints}
              workerPaymentHistory={selectedOrderWorkerHistory}
              onBack={() => setScreen('orders')}
              onEdit={() => openEditOrderModal(selectedOrder)}
              onBookAgain={() => openRebookOrderModal(selectedOrder)}
              onOpenOrder={openOrderDetail}
              onOpenWhatsApp={openWhatsAppForOrder}
              onChangeStatus={async (newStatus) => {
                const res = await api.changeOrderStatus(selectedOrder.order_id, newStatus);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Order status updated.', 'success');
              }}
              onUpdateAdvance={async (advanceGiven, supervisorId) => {
                const res = await api.updateOrderAdvance(selectedOrder.order_id, {
                  advance_given: advanceGiven,
                  supervisor_id: supervisorId,
                });
                setBootstrap(res.bootstrap);
                notify(res.message || 'Advance updated.', 'success');
              }}
              onOpenCompleteModal={() => setCompleteTarget(selectedOrder)}
              onCorrectFinancials={async (payload) => {
                const res = await api.correctCompletedFinancials(selectedOrder.order_id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Financials corrected.', 'success');
              }}
              onConfirmSettlement={async (note) => {
                const res = await api.confirmSettlement(selectedOrder.order_id, note);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Settlement confirmed.', 'success');
              }}
              onRecordSettlementEntry={async (payload) => {
                const res = await api.recordSettlementEntry(selectedOrder.order_id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Settlement entry recorded.', 'success');
              }}
              onOpenReschedule={() => setRescheduleTarget(selectedOrder)}
              onToggleFollowupDone={async (isDone) => {
                const res = await api.toggleFollowupDone(selectedOrder.order_id, isDone);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Follow-up status updated.', 'success');
              }}
              onIssueReceipt={(ord) => {
                setPreselectReceiptOrderId(ord.order_id);
                setScreen('receipts');
              }}
              onPreviewReceipt={(rec) => setPreviewReceiptFromDetail(rec)}
              onUpdateOrderWorkers={async (payload) => {
                const res = await api.adminUpdateOrderWorkers(selectedOrder.order_id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Order team updated.', 'success');
              }}
              onMarkWorkerPaid={async (orderWorkerId, payload) => {
                const res = await api.markOrderWorkerPaid(
                  selectedOrder.order_id,
                  orderWorkerId,
                  payload
                );
                setBootstrap(res.bootstrap);
                notify(res.message || 'Worker marked as paid.', 'success');
              }}
              onCorrectWorkerPayment={async (orderWorkerId, payload) => {
                const res = await api.correctOrderWorkerPayment(
                  selectedOrder.order_id,
                  orderWorkerId,
                  payload
                );
                setBootstrap(res.bootstrap);
                notify(res.message || 'Worker payment updated.', 'success');
              }}
              onCreateComplaint={async (payload) => {
                const res = await api.createOrderComplaint(selectedOrder.order_id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Complaint logged.', 'success');
              }}
              onUpdateComplaint={async (complaintId, payload) => {
                const res = await api.updateOrderComplaint(complaintId, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Complaint status updated.', 'success');
              }}
              onScheduleReturnVisit={async (complaintId, payload) => {
                const res = await api.scheduleReturnVisit(complaintId, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Return visit scheduled.', 'success');
              }}
            />
          )}

          {screen === 'quotations' && (
            <QuotationsView
              quotations={bootstrap.quotations}
              supervisors={bootstrap.supervisors}
              customers={bootstrap.customers}
              buildings={bootstrap.buildings}
              activePad={bootstrap.pads.quotation}
              companyLogoDataUrl={bootstrap.settings.company_logo_data_url}
              todayDhaka={bootstrap.todayDhaka}
              initialFilter={quotationsInitialFilter}
              leadPrefill={quotationLeadPrefill}
              onConsumeLeadPrefill={() => setQuotationLeadPrefill(null)}
              onArchivePdf={async (payload) => {
                const res = await api.saveIssuedPdf(payload);
                setBootstrap(res.bootstrap);
              }}
              onSaveQuotation={async (payload) => {
                const res = await api.saveQuotation(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Quotation saved.', 'success');
              }}
              onUpdateQuotationFollowup={async (quotationId, payload) => {
                const res = await api.updateQuotationFollowup(quotationId, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Quotation follow-up updated.', 'success');
              }}
              onConvertQuotation={async (quotationId, payload) => {
                const res = await api.convertQuotationToOrder(quotationId, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Converted to order.', 'success');
                if (res.order?.order_id) {
                  openOrderDetail(res.order.order_id);
                }
              }}
              onOpenWhatsApp={openWhatsAppForQuotation}
              onOpenOrder={openOrderDetail}
              onNotify={notify}
            />
          )}

          {screen === 'receipts' && (
            <ReceiptsView
              receipts={bootstrap.receipts}
              orders={bootstrap.orders}
              activePad={bootstrap.pads.receipt}
              companyLogoDataUrl={bootstrap.settings.company_logo_data_url}
              preselectOrderId={preselectReceiptOrderId}
              onConsumePreselectOrder={() => setPreselectReceiptOrderId('')}
              onIssueReceipt={async (payload) => {
                const res = await api.issueMoneyReceipt(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Money receipt issued.', 'success');
                return res.receipt;
              }}
              onArchivePdf={async (payload) => {
                const res = await api.saveIssuedPdf(payload);
                setBootstrap(res.bootstrap);
              }}
              onOpenOrder={openOrderDetail}
              onNotify={notify}
            />
          )}

          {screen === 'followups' && (
            <FollowupsView
              orders={bootstrap.orders}
              todayDhaka={bootstrap.todayDhaka}
              activeTab={followupTab}
              onChangeTab={setFollowupTab}
              onSelectOrder={openOrderDetail}
              onReschedule={(order) => setRescheduleTarget(order)}
              onToggleDone={async (orderId, isDone) => {
                const res = await api.toggleFollowupDone(orderId, isDone);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Follow-up updated.', 'success');
              }}
              onBookAgain={openRebookOrderModal}
              onOpenWhatsApp={(order) => openWhatsAppForOrder(order, 'repeat_cleaning_due')}
            />
          )}

          {screen === 'supervisors' && (
            <SupervisorsView
              supervisors={bootstrap.supervisors}
              orders={bootstrap.orders}
              onCreateSupervisor={async (payload) => {
                const res = await api.createSupervisor(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Supervisor account created.', 'success');
              }}
              onUpdateSupervisor={async (id, payload) => {
                const res = await api.updateSupervisor(id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Supervisor account updated.', 'success');
              }}
              onSelectOrder={openOrderDetail}
            />
          )}

          {screen === 'workers' && (
            <WorkersView
              workers={bootstrap.workers}
              orders={bootstrap.orders}
              onCreateWorker={async (payload) => {
                const res = await api.createWorker(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Worker added.', 'success');
              }}
              onUpdateWorker={async (id, payload) => {
                const res = await api.updateWorker(id, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Worker updated.', 'success');
              }}
            />
          )}

          {screen === 'reports' && (
            <ReportsView
              todayDhaka={bootstrap.todayDhaka}
              orders={bootstrap.orders}
              leads={bootstrap.leads}
              supervisors={bootstrap.supervisors}
              workers={bootstrap.workers}
              overhead={bootstrap.overhead}
              settlementEntries={bootstrap.settlementEntries}
              workerPaymentHistory={bootstrap.workerPaymentHistory}
              onCreateOverhead={async (payload) => {
                const res = await api.createOverhead(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Business expense recorded.', 'success');
              }}
              onDeleteOverhead={async (id) => {
                const res = await api.deleteOverhead(id);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Business expense deleted.', 'success');
              }}
              onOpenOrder={openOrderDetail}
              onNotify={(msg, isError) => notify(msg, isError ? 'error' : 'success')}
            />
          )}

          {screen === 'settings' && (
            <SettingsView
              currentUser={user}
              initialTab={settingsInitialTab}
              activeSupervisorsCount={bootstrap.supervisors.filter((s) => s.is_active).length}
              settings={bootstrap.settings}
              pads={bootstrap.pads}
              reminderLogs={bootstrap.reminderLogs}
              backupHistory={bootstrap.backupHistory}
              onOpenSupervisors={() => setScreen('supervisors')}
              onUserUpdated={(updated) => setUser(updated)}
              onDeviceEnrollmentChanged={(enrolled) => {
                setDeviceUnlockEnrolled(enrolled);
                if (enrolled) setShowEnrollBanner(false);
              }}
              onCurrentSessionRevoked={handleLogout}
              onSaveSettings={async (payload) => {
                const res = await api.saveSettings(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Settings saved.', 'success');
              }}
              onSaveCompanyLogo={async (payload) => {
                const res = await api.saveCompanyLogo(payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Company logo updated.', 'success');
              }}
              onDeleteCompanyLogo={async () => {
                const res = await api.deleteCompanyLogo();
                setBootstrap(res.bootstrap);
                notify(res.message || 'Company logo removed.', 'success');
              }}
              onUploadPad={async (padType, payload) => {
                const res = await api.uploadPad(padType, payload);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Document pad uploaded.', 'success');
              }}
              onSavePadFields={async (padType, fields) => {
                const res = await api.savePadFields(padType, fields);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Pad field layout saved.', 'success');
              }}
              onDeletePad={async (padType) => {
                const res = await api.deletePad(padType);
                setBootstrap(res.bootstrap);
                notify(res.message || 'Document pad deleted.', 'success');
              }}
              onSyncGoogle={async () => {
                const res = await api.syncWithGoogle();
                setBootstrap(res.bootstrap);
                notify(res.message || 'Primary Google sync completed.', 'success');
              }}
              onSendTestEmail={async () => {
                const res = await api.sendTestEmail();
                setBootstrap(res.bootstrap);
                notify(res.message || 'Test email sent.', 'success');
              }}
              onRunReminderCheck={async () => {
                const res = await api.runReminderCheck();
                setBootstrap(res.bootstrap);
                notify(res.message || 'Reminder check completed.', 'success');
              }}
              onVerifyRemindersAfterRestore={async () => {
                const res = await api.verifyRemindersAfterRestore();
                setBootstrap(res.bootstrap);
                notify(res.message || 'Reminders resumed.', 'success');
              }}
              onRefreshBootstrap={loadAdminBootstrap}
              onNotify={notify}
            />
          )}
        </main>
      </div>

      {/* Global Modals */}
      <OrderFormModal
        open={orderModalOpen}
        mode={orderModalMode}
        sourceOrder={orderModalSource}
        leadPrefill={orderLeadPrefill}
        buildingPrefill={orderBuildingPrefill}
        customers={bootstrap.customers}
        buildings={bootstrap.buildings}
        supervisors={bootstrap.supervisors}
        workers={bootstrap.workers}
        onClose={() => {
          setOrderModalOpen(false);
          setOrderLeadPrefill(null);
          setOrderBuildingPrefill(null);
        }}
        onSubmit={async (payload, isEdit) => {
          if (isEdit && orderModalSource) {
            const res = await api.updateOrder(orderModalSource.order_id, payload);
            setBootstrap(res.bootstrap);
            notify(res.message || 'Order updated.', 'success');
            setOrderModalOpen(false);
            openOrderDetail(res.order.order_id);
          } else {
            const res = await api.createOrder(payload);
            setBootstrap(res.bootstrap);
            notify(res.message || 'Order created.', 'success');
            setOrderModalOpen(false);
            setOrderLeadPrefill(null);
            setOrderBuildingPrefill(null);
            openOrderDetail(res.order.order_id);
          }
        }}
        onCreateSupervisor={async (payload) => {
          const res = await api.createSupervisor(payload);
          setBootstrap(res.bootstrap);
          notify(res.message || 'Supervisor account created.', 'success');
          return res.supervisor;
        }}
        onOpenConflictingOrder={(conflictOrderId) => {
          setOrderModalOpen(false);
          openOrderDetail(conflictOrderId);
        }}
      />

      <CompleteOrderModal
        open={Boolean(completeTarget)}
        order={completeTarget}
        settings={bootstrap.settings}
        onClose={() => setCompleteTarget(null)}
        onConfirm={async (params) => {
          const res = await api.completeOrderAsAdmin(params.order_id, {
            completion_date: params.completion_date,
            transport_cost: params.transport_cost,
            meals_cost: params.meals_cost,
            other_expenses: params.other_expenses,
            full_bill_collected: params.full_bill_collected,
            confirmed_worker_ids: params.confirmed_worker_ids,
            followup_mode: params.followup_mode,
            custom_value: params.custom_value,
            custom_unit: params.custom_unit,
            followup_date: params.followup_date,
          });
          setBootstrap(res.bootstrap);
          setCompleteTarget(null);
          notify(res.message || 'Order marked as completed.', 'success');
        }}
      />

      <RescheduleFollowupModal
        open={Boolean(rescheduleTarget)}
        order={rescheduleTarget}
        settings={bootstrap.settings}
        onClose={() => setRescheduleTarget(null)}
        onConfirm={async (params) => {
          const res = await api.rescheduleFollowup(params.order_id, {
            followup_mode: params.followup_mode,
            base_date: params.base_date,
            custom_value: params.custom_value,
            custom_unit: params.custom_unit,
            followup_date: params.followup_date,
          });
          setBootstrap(res.bootstrap);
          setRescheduleTarget(null);
          notify(res.message || 'Follow-up date updated.', 'success');
        }}
      />

      <DocumentPreviewModal
        open={Boolean(previewReceiptFromDetail)}
        type="receipt"
        receipt={previewReceiptFromDetail}
        fallbackPad={bootstrap.pads.receipt}
        companyLogoDataUrl={bootstrap.settings.company_logo_data_url}
        onArchivePdf={async (payload) => {
          const res = await api.saveIssuedPdf(payload);
          setBootstrap(res.bootstrap);
        }}
        onClose={() => setPreviewReceiptFromDetail(null)}
        onNotify={notify}
      />

      <WhatsAppPreviewModal
        request={whatsAppRequest}
        onClose={() => setWhatsAppRequest(null)}
      />

      <ChangePasswordModal
        open={changePassOpen}
        user={user}
        onClose={() => setChangePassOpen(false)}
        onSuccess={(msg) => notify(msg, 'success')}
      />

      {/* Toast Notification */}
      {toast && (
        <div
          className={`fixed bottom-4 right-4 z-50 max-w-sm rounded-xl px-4 py-3 text-sm font-semibold text-white shadow-xl ${
            toast.tone === 'error' ? 'bg-red-600' : 'bg-[#0F766E]'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
