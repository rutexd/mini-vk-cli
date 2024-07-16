export interface IMessage {
  id: number;
  from_id: number;
  text: string;
  date: number;
  attachments?: any[];
}
