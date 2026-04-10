import { sleep } from 'k6';
import { Options } from 'k6/options';
import http from 'k6/http';
// @ts-expect-error: K6 cannot find module due to path alias
import K9Modules from './k6.modules.ts';

const serverPath = 'http://localhost:5000/api';

export const options: Options = {
  stages: [
    { duration: '6s', target: 10 },
    { duration: '8s', target: 20 },
    { duration: '6s', target: 10 },
    { duration: '30s', target: 0 }
  ]
};

export function setup() {
  const assembleUrl = `${serverPath}/assemble/complects`;

  const shipmentIdsUrl = `${serverPath}/shipments/shipments/k6`;

  const assembleRes = http.get(assembleUrl, { timeout: '30s' });
  const shipmentIdsRes = http.get(shipmentIdsUrl, { timeout: '30s' });

  if (assembleRes.status !== 200 && assembleRes.status !== 201) {
    throw new Error(`Failed to fetch assemblies: ${assembleRes.status}`);
  }

  if (shipmentIdsRes.status !== 200) {
    throw new Error(`Failed to fetch shipment id: ${shipmentIdsRes.status}`);
  }

  return {
    allAssembles: assembleRes.json(),
    allShipmentsIds: shipmentIdsRes.json()
  };
}

/**
 * The `invoker` function iterates over modules and invokes all methods of each module instance that
 * are functions.
 * @param {any} modules - The `modules` parameter in the `invoker` function is expected to be an object
 * containing instances of classes or objects. The function iterates over each key in the `modules`
 * object, checks if the value is an object, and then invokes all the methods of that object except for
 * the constructor
 */
export const invoker = (modules: any): void => {
  for (const key in modules) {
    const instance = modules[key];
    if (instance && typeof instance === 'object') {
      const methods = Object.getOwnPropertyNames(
        Object.getPrototypeOf(instance)
      );
      for (const method of methods) {
        if (
          method !== 'constructor' &&
          typeof instance[method] === 'function'
        ) {
          instance[method]();
        }
      }
    }
  }
};

export default function main(data: {
  allAssembles: any[];
  allShipmentsIds: {
    cbedIds: number[];
    detalIds: number[];
  };
}): void {
  const modules = K9Modules({
    serverPath,
    allAssembles: data.allAssembles,
    allShipmentsIds: data.allShipmentsIds
  });
  invoker(modules);
  sleep(1);
}
