import { invoke } from '@tauri-apps/api/core';

export function invokeTauri<TResult>(command: string) {
  return invoke<TResult>(command);
}

export function invokeTauriWithRequest<TResult, TRequest>(command: string, request: TRequest) {
  return invoke<TResult>(command, { request });
}
