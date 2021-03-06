<template>
  <div class="page-confirm frame flex flex-col h-100">
    <div class="frame-block">
      <div class="flex">
        <h1 class="hidden-sm"><span v-text="i18n('labelInstall')"></span> - <span v-text="i18n('extName')"></span></h1>
        <div class="flex-auto"></div>
        <div>
          <dropdown class="confirm-options" align="right">
            <button slot="toggle" v-text="i18n('buttonInstallOptions')"></button>
            <label>
              <setting-check name="closeAfterInstall" @change="checkClose" />
              <span class="ml-1" v-text="i18n('installOptionClose')"></span>
            </label>
            <label>
              <setting-check name="trackLocalFile" :disabled="closeAfterInstall" />
              <span class="ml-1" v-text="i18n('installOptionTrack')"></span>
            </label>
          </dropdown>
          <button v-text="i18n('buttonConfirmInstallation')"
          :disabled="!installable" @click="installScript"></button>
          <button v-text="i18n('buttonClose')" @click="close"></button>
        </div>
      </div>
      <div class="flex">
        <div class="ellipsis flex-auto mr-2" :title="info.url" v-text="info.url"></div>
        <div v-text="message"></div>
      </div>
    </div>
    <div class="frame-block flex-auto pos-rel">
      <vm-code class="abs-full" readonly :value="code" :commands="commands" />
    </div>
  </div>
</template>

<script>
import Dropdown from 'vueleton/lib/dropdown';
import {
  sendMessage, leftpad, request, buffer2string, isRemote, getFullUrl,
} from '#/common';
import options from '#/common/options';
import initCache from '#/common/cache';
import VmCode from '#/common/ui/code';
import SettingCheck from '#/common/ui/setting-check';
import { route } from '#/common/router';

const cache = initCache({});

export default {
  components: {
    Dropdown,
    VmCode,
    SettingCheck,
  },
  data() {
    return {
      installable: false,
      dependencyOK: false,
      closeAfterInstall: options.get('closeAfterInstall'),
      message: '',
      code: '',
      commands: {
        close: this.close,
      },
      info: {},
    };
  },
  computed: {
    isLocal() {
      return !isRemote(this.info.url);
    },
  },
  mounted() {
    this.message = this.i18n('msgLoadingData');
    this.loadInfo()
    .then(() => {
      const id = route.paths[0];
      this.guard = setInterval(() => {
        sendMessage({
          cmd: 'CacheHit',
          data: {
            key: `confirm-${id}`,
          },
        });
      }, 5000);
    }, () => {
      this.close();
      return Promise.reject();
    })
    .then(this.loadData)
    .then(this.parseMeta);
  },
  beforeDestroy() {
    if (this.guard) {
      clearInterval(this.guard);
      this.guard = null;
    }
  },
  methods: {
    loadInfo() {
      const id = route.paths[0];
      return sendMessage({
        cmd: 'CacheLoad',
        data: `confirm-${id}`,
      })
      .then(info => {
        if (!info) return Promise.reject();
        this.info = info;
      });
    },
    loadData(changedOnly) {
      this.installable = false;
      const { code: oldCode } = this;
      return this.getScript(this.info.url)
      .then(code => {
        if (changedOnly && oldCode === code) return Promise.reject();
        this.code = code;
      });
    },
    parseMeta() {
      return sendMessage({
        cmd: 'ParseMeta',
        data: this.code,
      })
      .then(script => {
        const urls = Object.keys(script.resources)
        .map(key => script.resources[key]);
        const length = script.require.length + urls.length;
        if (!length) return;
        let finished = 0;
        const error = [];
        const updateStatus = () => {
          this.message = this.i18n('msgLoadingDependency', [finished, length]);
        };
        updateStatus();
        this.require = {};
        this.resources = {};
        const promises = script.require.map(url => {
          const fullUrl = getFullUrl(url, this.info.url);
          return this.getFile(fullUrl, { useCache: true }).then(res => {
            this.require[fullUrl] = res;
          });
        })
        .concat(urls.map(url => {
          const fullUrl = getFullUrl(url, this.info.url);
          return this.getFile(fullUrl, { isBlob: true, useCache: true })
          .then(res => {
            this.resources[fullUrl] = res;
          });
        }))
        .map(promise => promise.then(() => {
          finished += 1;
          updateStatus();
        }, url => {
          error.push(url);
        }));
        return Promise.all(promises).then(() => {
          if (error.length) return Promise.reject(error.join('\n'));
          this.dependencyOK = true;
        });
      })
      .then(() => {
        this.message = this.i18n('msgLoadedData');
        this.installable = true;
      }, err => {
        this.message = this.i18n('msgErrorLoadingDependency', [err]);
        return Promise.reject();
      });
    },
    close() {
      sendMessage({ cmd: 'TabClose' });
    },
    getFile(url, { isBlob, useCache } = {}) {
      const cacheKey = isBlob ? `blob+${url}` : `text+${url}`;
      if (useCache && cache.has(cacheKey)) {
        return Promise.resolve(cache.get(cacheKey));
      }
      return request(url, {
        responseType: isBlob ? 'arraybuffer' : null,
      })
      .then(({ data }) => (isBlob ? window.btoa(buffer2string(data)) : data))
      .then(data => {
        if (useCache) cache.put(cacheKey, data);
        return data;
      });
    },
    getScript(url) {
      return sendMessage({
        cmd: 'CacheLoad',
        data: url,
      })
      .then(text => text || Promise.reject())
      .catch(() => this.getFile(url))
      .catch(() => {
        this.message = this.i18n('msgErrorLoadingData');
        throw url;
      });
    },
    getTimeString() {
      const now = new Date();
      return `${leftpad(now.getHours(), 2)}:${leftpad(now.getMinutes(), 2)}:${leftpad(now.getSeconds(), 2)}`;
    },
    installScript() {
      this.installable = false;
      sendMessage({
        cmd: 'ParseScript',
        data: {
          code: this.code,
          url: this.info.url,
          from: this.info.from,
          require: this.require,
          resources: this.resources,
        },
      })
      .then(result => {
        this.message = `${result.update.message}[${this.getTimeString()}]`;
        if (this.closeAfterInstall) this.close();
        else if (this.isLocal && options.get('trackLocalFile')) this.trackLocalFile();
      }, err => {
        this.message = `${err}`;
        this.installable = true;
      });
    },
    trackLocalFile() {
      new Promise(resolve => {
        setTimeout(resolve, 2000);
      })
      .then(() => this.loadData(true))
      .then(this.parseMeta)
      .then(() => {
        const track = options.get('trackLocalFile');
        if (track) this.installScript();
      }, () => {
        this.trackLocalFile();
      });
    },
    checkClose(value) {
      this.closeAfterInstall = value;
      if (value) options.set('trackLocalFile', false);
    },
  },
};
</script>

<style>
.confirm-options {
  label {
    display: block;
  }
  .vl-dropdown-menu {
    width: 13rem;
  }
}
</style>
