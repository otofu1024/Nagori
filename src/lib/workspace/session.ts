export type Failure = { code: string; message: string };
export type OpenedDocument = { path: string; text: string; baseline: string; readonly: boolean };
export function failure(error: unknown): Failure {
  if (typeof error === 'object' && error !== null && 'message' in error) return {code:'code' in error ? String(error.code) : 'ERROR', message:String(error.message)};
  if (typeof error === 'string') { try { return failure(JSON.parse(error)); } catch {} }
  return {code:'ERROR', message:String(error)};
}
export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error' | 'conflict' | 'missing';
export class EditSession {
  path: string;
  text: string;
  baseline: string;
  readonly: boolean;
  generation = 0;
  savedGeneration = 0;
  issue: Failure | null = null;
  composing = false;
  private saving: Promise<boolean> | null = null;
  private write: (path:string, text:string, baseline:string)=>Promise<{baseline:string}>;
  private update:()=>void;
  constructor(doc: OpenedDocument, write: (path:string, text:string, baseline:string)=>Promise<{baseline:string}>, update:()=>void) {
    this.write=write;this.update=update;
    this.path=doc.path; this.text=doc.text; this.baseline=doc.baseline; this.readonly=doc.readonly;
  }
  get isSaving() { return this.saving !== null; }
  get dirty() { return this.generation !== this.savedGeneration; }
  get status(): SaveStatus {
    if(this.issue) return this.issue.code==='CONFLICT'?'conflict':this.issue.code==='MISSING'?'missing':'error';
    return this.saving?'saving':this.dirty?'dirty':'saved';
  }
  edit(text:string) { if(this.readonly || text===this.text) return; this.text=text; this.generation++; this.update(); }
  block(error:unknown) { this.issue=failure(error); this.update(); }
  async flush():Promise<boolean> {
    if(this.saving) { if(!await this.saving) return false; return this.flush(); }
    if(this.issue || this.composing) return false;
    if(!this.dirty) return true;
    this.saving=this.saveLoop(); this.update();
    try { return await this.saving; } finally { this.saving=null; this.update(); }
  }
  private async saveLoop():Promise<boolean> {
    while(this.dirty && !this.issue && !this.composing) {
      const generation=this.generation, text=this.text;
      try { const result=await this.write(this.path,text,this.baseline); this.baseline=result.baseline; this.savedGeneration=generation; this.update(); }
      catch(error) {this.block(error);return false;}
    }
    return !this.dirty;
  }
  retry() { this.issue=null; this.update(); }
  reload(doc:OpenedDocument) {this.text=doc.text;this.baseline=doc.baseline;this.readonly=doc.readonly;this.generation++;this.savedGeneration=this.generation;this.issue=null;this.update();}
}
