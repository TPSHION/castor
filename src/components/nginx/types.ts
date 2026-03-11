export type NginxMode = 'list' | 'create' | 'edit' | 'detail' | 'config';

export type NginxFormState = {
  id?: string;
  profileId: string;
  name: string;
  nginxBin: string;
  confPath: string;
  pidPath: string;
  useSudo: boolean;
};
