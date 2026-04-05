import BaseBuilder from './BaseBuilder';
import MacBuilder from './MacBuilder';
import { PakeAppOptions } from '@/types';

const { platform } = process;

const buildersMap: Record<
  string,
  new (options: PakeAppOptions) => BaseBuilder
> = {
  darwin: MacBuilder,
};

export default class BuilderProvider {
  static create(options: PakeAppOptions): BaseBuilder {
    const Builder = buildersMap[platform];
    if (!Builder) {
      throw new Error('Only macOS is supported!');
    }
    return new Builder(options);
  }
}
