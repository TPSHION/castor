import type {
  ConnectRequest,
  DisconnectRequest,
  LocalConnectRequest,
  ResizeRequest,
  SendInputRequest,
  SessionSummary
} from '../../types';
import { invokeTauriWithRequest } from './tauri';

export function connectSsh(request: ConnectRequest) {
  return invokeTauriWithRequest<SessionSummary, ConnectRequest>('connect_ssh', request);
}

export function connectLocalTerminal(request: LocalConnectRequest = {}) {
  return invokeTauriWithRequest<SessionSummary, LocalConnectRequest>('connect_local_terminal', request);
}

export function disconnectSsh(request: DisconnectRequest) {
  return invokeTauriWithRequest<void, DisconnectRequest>('disconnect_ssh', request);
}

export function sendSshInput(request: SendInputRequest) {
  return invokeTauriWithRequest<void, SendInputRequest>('send_ssh_input', request);
}

export function resizeSsh(request: ResizeRequest) {
  return invokeTauriWithRequest<void, ResizeRequest>('resize_ssh', request);
}
