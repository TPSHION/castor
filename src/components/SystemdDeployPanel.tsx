import type { ConnectionProfile } from '../types';
import {
  SystemdDeleteConfirmDialog,
  SystemdDetailPanel,
  SystemdFormHeader,
  SystemdFormPanel,
  SystemdListPanel,
  SystemdLogFullscreenModal
} from './systemd/SystemdPanelPartials';
import { useSystemdDeploy } from '../app/hooks/useSystemdDeploy';

type SystemdDeployPanelProps = {
  profiles: ConnectionProfile[];
};

export function SystemdDeployPanel({ profiles }: SystemdDeployPanelProps) {
  const vm = useSystemdDeploy(profiles);

  return (
    <>
      <section className={vm.systemdMode === 'list' ? 'systemd-panel' : 'systemd-panel systemd-panel-form'}>
        {vm.systemdMode === 'list' ? (
          <SystemdListPanel
            profilesCount={profiles.length}
            systemdBusy={vm.systemdBusy}
            systemdMessage={vm.systemdMessage}
            systemdMessageIsError={vm.systemdMessageIsError}
            systemdServices={vm.systemdServices}
            profileNameMap={vm.profileNameMap}
            systemdDeletingServiceId={vm.systemdDeletingServiceId}
            onRefreshSystemdList={vm.refreshSystemdList}
            onStartCreateSystemd={vm.onStartCreateSystemd}
            onOpenSystemdDetail={vm.onOpenSystemdDetail}
            onEditSystemd={vm.onEditSystemd}
            requestDeleteSystemdFromList={vm.requestDeleteSystemdFromList}
          />
        ) : vm.systemdMode === 'detail' ? (
          <SystemdDetailPanel
            selectedSystemdDetailService={vm.selectedSystemdDetailService}
            detailBackDisabled={vm.detailBackDisabled}
            detailStatusActionDisabled={vm.detailStatusActionDisabled}
            canDetailStart={vm.canDetailStart}
            canDetailStop={vm.canDetailStop}
            systemdDetailAction={vm.systemdDetailAction}
            systemdDetailStatusBusy={vm.systemdDetailStatusBusy}
            systemdDetailStatus={vm.systemdDetailStatus}
            systemdMessage={vm.systemdMessage}
            systemdMessageIsError={vm.systemdMessageIsError}
            profileNameMap={vm.profileNameMap}
            canReadSystemdLogs={vm.canReadSystemdLogs}
            systemdDetailLogsBusy={vm.systemdDetailLogsBusy}
            systemdDetailLogsRealtime={vm.systemdDetailLogsRealtime}
            filteredSystemdDetailLogs={vm.filteredSystemdDetailLogs}
            highlightedSystemdLogNodes={vm.highlightedSystemdLogNodes}
            hasAppliedSystemdLogFilter={vm.hasAppliedSystemdLogFilter}
            isSystemdLogFilterDirty={vm.isSystemdLogFilterDirty}
            systemdLogFilterKeywordDraft={vm.systemdLogFilterKeywordDraft}
            systemdLogFilterCaseSensitiveDraft={vm.systemdLogFilterCaseSensitiveDraft}
            textInputProps={vm.textInputProps}
            systemdLogPanelRef={vm.systemdLogPanelRef}
            onBackSystemdList={vm.onBackSystemdList}
            onEditSystemd={vm.onEditSystemd}
            onDetailControlSystemd={vm.onDetailControlSystemd}
            refreshSystemdDetailStatus={vm.refreshSystemdDetailStatus}
            requestDeleteSystemdFromDetail={vm.requestDeleteSystemdFromDetail}
            loadSystemdDetailLogs={vm.loadSystemdDetailLogs}
            onToggleSystemdRealtimeLogs={vm.onToggleSystemdRealtimeLogs}
            clearLoadedSystemdLogs={vm.clearLoadedSystemdLogs}
            setSystemdLogFullscreen={vm.setSystemdLogFullscreen}
            setSystemdLogFilterKeywordDraft={vm.setSystemdLogFilterKeywordDraft}
            setSystemdLogFilterCaseSensitiveDraft={vm.setSystemdLogFilterCaseSensitiveDraft}
            applySystemdLogFilter={vm.applySystemdLogFilter}
            clearSystemdLogFilter={vm.clearSystemdLogFilter}
          />
        ) : (
          <>
            <SystemdFormHeader
              mode={vm.systemdMode}
              systemdBusy={vm.systemdBusy}
              systemdValidation={vm.systemdValidation}
              systemdSubmitAction={vm.systemdSubmitAction}
              systemdRemoteServicesBusy={vm.systemdRemoteServicesBusy}
              systemdImportBusy={vm.systemdImportBusy}
              profiles={profiles}
              onBackSystemdList={vm.onBackSystemdList}
              onOpenSystemdImportPanel={vm.onOpenSystemdImportPanel}
              onSubmitSystemdForm={vm.onSubmitSystemdForm}
            />

            <SystemdFormPanel
              profiles={profiles}
              textInputProps={vm.textInputProps}
              systemdBusy={vm.systemdBusy}
              systemdMessage={vm.systemdMessage}
              systemdMessageIsError={vm.systemdMessageIsError}
              systemdImportPanelOpen={vm.systemdImportPanelOpen}
              systemdRemoteServicesBusy={vm.systemdRemoteServicesBusy}
              systemdImportBusy={vm.systemdImportBusy}
              systemdRemoteServices={vm.systemdRemoteServices}
              systemdRemoteServiceKeyword={vm.systemdRemoteServiceKeyword}
              filteredSystemdRemoteServices={vm.filteredSystemdRemoteServices}
              systemdSelectedRemoteServiceName={vm.systemdSelectedRemoteServiceName}
              existingSystemdServiceNameSet={vm.existingSystemdServiceNameSet}
              selectedRemoteServiceAlreadyAdded={vm.selectedRemoteServiceAlreadyAdded}
              systemdForm={vm.systemdForm}
              setSystemdForm={vm.setSystemdForm}
              setSystemdImportPanelOpen={vm.setSystemdImportPanelOpen}
              setSystemdRemoteServiceKeyword={vm.setSystemdRemoteServiceKeyword}
              setSystemdSelectedRemoteServiceName={vm.setSystemdSelectedRemoteServiceName}
              onImportRemoteSystemdService={vm.onImportRemoteSystemdService}
              loadRemoteSystemdServiceList={vm.loadRemoteSystemdServiceList}
              selectedSystemdProfile={vm.selectedSystemdProfile}
              selectedServiceTypeExamples={vm.selectedServiceTypeExamples}
              systemdServiceNameValidationMessage={vm.systemdServiceNameValidationMessage}
            />
          </>
        )}
      </section>

      <SystemdLogFullscreenModal
        open={vm.systemdLogFullscreen}
        selectedSystemdDetailService={vm.selectedSystemdDetailService}
        canReadSystemdLogs={vm.canReadSystemdLogs}
        systemdDetailLogsBusy={vm.systemdDetailLogsBusy}
        systemdDetailLogsRealtime={vm.systemdDetailLogsRealtime}
        systemdLogFilterKeywordDraft={vm.systemdLogFilterKeywordDraft}
        systemdLogFilterCaseSensitiveDraft={vm.systemdLogFilterCaseSensitiveDraft}
        isSystemdLogFilterDirty={vm.isSystemdLogFilterDirty}
        hasAppliedSystemdLogFilter={vm.hasAppliedSystemdLogFilter}
        filteredSystemdDetailLogs={vm.filteredSystemdDetailLogs}
        highlightedSystemdLogNodes={vm.highlightedSystemdLogNodes}
        textInputProps={vm.textInputProps}
        systemdLogFullscreenRef={vm.systemdLogFullscreenRef}
        loadSystemdDetailLogs={vm.loadSystemdDetailLogs}
        onToggleSystemdRealtimeLogs={vm.onToggleSystemdRealtimeLogs}
        clearLoadedSystemdLogs={vm.clearLoadedSystemdLogs}
        setSystemdLogFullscreen={vm.setSystemdLogFullscreen}
        setSystemdLogFilterKeywordDraft={vm.setSystemdLogFilterKeywordDraft}
        setSystemdLogFilterCaseSensitiveDraft={vm.setSystemdLogFilterCaseSensitiveDraft}
        applySystemdLogFilter={vm.applySystemdLogFilter}
        clearSystemdLogFilter={vm.clearSystemdLogFilter}
      />

      <SystemdDeleteConfirmDialog
        systemdDeleteDialog={vm.systemdDeleteDialog}
        isDeleteConfirmBusy={vm.isDeleteConfirmBusy}
        setSystemdDeleteDialog={vm.setSystemdDeleteDialog}
        onConfirmDeleteSystemd={vm.onConfirmDeleteSystemd}
      />
    </>
  );
}
