// @ts-expect-error: K6 cannot find module due to path alias
import K6Metaloworking from '../../modules/metaloworking/tests/metaloworking.k6.test.ts';
// @ts-expect-error: K6 cannot find module due to path alias
import K6Assembly from '../../modules/assemble/tests/assembly.k6.test.ts';
// @ts-expect-error: K6 cannot find module due to path alias
import K6AssemblyKit from '../../modules/assemble-kit/tests/assemble-kit.k6.test.ts';
// @ts-expect-error: K6 cannot find module due to path alias
import K6Shipments from '../../modules/shipments/tests/shipments.k6.test.ts';

const K9Modules = (data: {
  serverPath: string;
  allAssembles: any[];
  allShipmentsIds: {
    cbedIds: number[];
    detalIds: number[];
  };
}) => ({
  K6Assembly: new K6Assembly(data.serverPath),
  K6AssemblyKit: new K6AssemblyKit(data.serverPath, data.allAssembles),
  K6Shipments: new K6Shipments(data.serverPath, data.allShipmentsIds),
  K6Metaloworking: new K6Metaloworking(data.serverPath)
});

export default K9Modules;
