// @flow

import { extend, bindAll } from '../util/util';
import { Event, Evented } from '../util/evented';
import DOM from '../util/dom';
import LngLat from '../geo/lng_lat';
import Point from '@mapbox/point-geometry';
import window from '../util/window';
import smartWrap from '../util/smart_wrap';
import { type Anchor, anchorTranslate, applyAnchorClass } from './anchor';

import type Map from './map';
import type {LngLatLike} from '../geo/lng_lat';
import type {PointLike} from '@mapbox/point-geometry';

const defaultOptions = {
    closeButton: true,
    closeOnClick: true,
    className: ''
};

export type Offset = number | PointLike | {[Anchor]: PointLike};

export type PopupOptions = {
    closeButton?: boolean,
    closeOnClick?: boolean,
    anchor?: Anchor,
    offset?: Offset,
    className?: string
};

/**
 * 弹窗（popup）组件
 *
 * @param {Object} [options]
 * @param {boolean} [options.closeButton=true] 如果为 `true`，弹窗右上角将会 出现一个关闭按钮。
 * @param {boolean} [options.closeOnClick=true] 如果为 `true`， 点击地图时 弹窗将关闭。
 * @param {string} [options.anchor] - 指定弹窗相对于定位坐标（由{@link Popup#setLngLat}设定）位置。
 *   选项有 `'center'`, `'top'`, `'bottom'`, `'left'`, `'right'`, `'top-left'`,
 *   `'top-right'`, `'bottom-left'`, 以及 `'bottom-right'`. 如未设置， 将对锚点进行动态设置，
 *   以保证弹窗落入地图容器内，动态设置会偏向 `'bottom'`。
 * @param {number|PointLike|Object} [options.offset] -
 *  指定弹窗位置的像素偏移量，可设置为以下值:
 *   - 表示离弹窗位置距离的一个数字
 *   - 表示常数偏移的 {@link PointLike} 对象
 *   - 指明每个锚点位置偏移程度的 {@link Point} 对象，负偏移表示向左和向上。
 * @param {string} [options.className] 添加到弹窗容器的CSS类名，类名之间以空格分隔。
 * @example
 * var markerHeight = 50, markerRadius = 10, linearOffset = 25;
 * var popupOffsets = {
 *  'top': [0, 0],
 *  'top-left': [0,0],
 *  'top-right': [0,0],
 *  'bottom': [0, -markerHeight],
 *  'bottom-left': [linearOffset, (markerHeight - markerRadius + linearOffset) * -1],
 *  'bottom-right': [-linearOffset, (markerHeight - markerRadius + linearOffset) * -1],
 *  'left': [markerRadius, (markerHeight - markerRadius) * -1],
 *  'right': [-markerRadius, (markerHeight - markerRadius) * -1]
 *  };
 * var popup = new mapboxgl.Popup({offset: popupOffsets, className: 'my-class'})
 *   .setLngLat(e.lngLat)
 *   .setHTML("<h1>Hello World!</h1>")
 *   .addTo(map);
 * @see [Display a popup](https://www.mapbox.com/mapbox-gl-js/example/popup/)
 * @see [Display a popup on hover](https://www.mapbox.com/mapbox-gl-js/example/popup-on-hover/)
 * @see [Display a popup on click](https://www.mapbox.com/mapbox-gl-js/example/popup-on-click/)
 * @see [Attach a popup to a marker instance](https://www.mapbox.com/mapbox-gl-js/example/set-popup/)
 */
export default class Popup extends Evented {
    _map: Map;
    options: PopupOptions;
    _content: HTMLElement;
    _container: HTMLElement;
    _closeButton: HTMLElement;
    _tip: HTMLElement;
    _lngLat: LngLat;
    _pos: ?Point;

    constructor(options: PopupOptions) {
        super();
        this.options = extend(Object.create(defaultOptions), options);
        bindAll(['_update', '_onClickClose'], this);
    }

    /**
     * 添加弹窗到地图上。
     *
     * @param {Map} map 需要添加弹窗的 Mapbox GL JS 地图
     * @returns {Popup} `this`
     */
    addTo(map: Map) {
        this._map = map;
        this._map.on('move', this._update);
        if (this.options.closeOnClick) {
            this._map.on('click', this._onClickClose);
        }
        this._update();

        /**
         * 弹窗开启（手动开启或者由程序开启）时触发。
         *
         * @event open
         * @memberof Popup
         * @instance
         * @type {Object}
         * @property {Popup} 被开启的弹窗对象
         */
        this.fire(new Event('open'));

        return this;
    }

    /**
     * @returns {boolean} 弹窗打开时，返回 `true` , 弹窗关闭时，返回 `false` 。
     */
    isOpen() {
        return !!this._map;
    }

    /**
     * 从地图上移除弹窗。
     *
     * @example
     * var popup = new mapboxgl.Popup().addTo(map);
     * popup.remove();
     * @returns {Popup} `this`
     */
    remove() {
        if (this._content) {
            DOM.remove(this._content);
        }

        if (this._container) {
            DOM.remove(this._container);
            delete this._container;
        }

        if (this._map) {
            this._map.off('move', this._update);
            this._map.off('click', this._onClickClose);
            delete this._map;
        }

        /**
         * 弹窗关闭（手动关闭或者由程序关闭）时触发。
         *
         * @event close
         * @memberof Popup
         * @instance
         * @type {Object}
         * @property {Popup} 被关闭的弹窗对象
         */
        this.fire(new Event('close'));

        return this;
    }

    /**
     * 返回弹窗锚点（anchor）的地理位置。
     *
     * 结果返回的经度可能与先前由`setLngLat`设置的经度相差360度的倍数，
     * 因为 `Popup` 会包裹锚点经度以使弹窗保持在屏幕上。 
     *
     * @returns {LngLat} 弹窗锚点的地理位置。
     */
    getLngLat() {
        return this._lngLat;
    }

    /**
     * 设置弹窗锚点的地理位置，并将弹窗移到该处。
     *
     * @param lnglat 设置为弹窗锚点的地理位置。
     * @returns {Popup} `this`
     */
    setLngLat(lnglat: LngLatLike) {
        this._lngLat = LngLat.convert(lnglat);
        this._pos = null;
        this._update();
        return this;
    }

    /**
     * 将弹窗内容设置为文本字符串。
     *
     * 该函数会在DOM中创建一个 [Text](https://developer.mozilla.org/en-US/docs/Web/API/Text) 节点,
     * 因此不能插入原生HTML. 当由用户提供弹窗内容时，为了安全起见，
     * 可使用该方法来防止 XSS 攻击。
     *
     * @param text 弹窗的文本内容。
     * @returns {Popup} `this`
     * @example
     * var popup = new mapboxgl.Popup()
     *   .setLngLat(e.lngLat)
     *   .setText('Hello, world!')
     *   .addTo(map);
     */
    setText(text: string) {
        return this.setDOMContent(window.document.createTextNode(text));
    }

    /**
     * 将弹窗内容设置为 HTML 字符串。
     *
     * 该方法不会进行 HTML 过滤或清理，因此必须使用
     * 可信的文本内容。如果要输入不信任的文本字符串，
     * 应考虑使用 {@link Popup#setText} 。
     *
     * @param html 表示弹窗内容的HTML字符串
     * @returns {Popup} `this`
     */
    setHTML(html: string) {
        const frag = window.document.createDocumentFragment();
        const temp = window.document.createElement('body');
        let child;
        temp.innerHTML = html;
        while (true) {
            child = temp.firstChild;
            if (!child) break;
            frag.appendChild(child);
        }

        return this.setDOMContent(frag);
    }

    /**
     * 将弹窗内容设置为DOM节点元素。
     *
     * @param htmlNode 用做弹窗内容的DOM节点
     * @returns {Popup} `this`
     * @example
     * // create an element with the popup content
     * var div = window.document.createElement('div');
     * div.innerHTML = 'Hello, world!';
     * var popup = new mapboxgl.Popup()
     *   .setLngLat(e.lngLat)
     *   .setDOMContent(div)
     *   .addTo(map);
     */
    setDOMContent(htmlNode: Node) {
        this._createContent();
        this._content.appendChild(htmlNode);
        this._update();
        return this;
    }

    _createContent() {
        if (this._content) {
            DOM.remove(this._content);
        }

        this._content = DOM.create('div', 'mapboxgl-popup-content', this._container);

        if (this.options.closeButton) {
            this._closeButton = DOM.create('button', 'mapboxgl-popup-close-button', this._content);
            this._closeButton.type = 'button';
            this._closeButton.setAttribute('aria-label', 'Close popup');
            this._closeButton.innerHTML = '&#215;';
            this._closeButton.addEventListener('click', this._onClickClose);
        }
    }

    _update() {
        if (!this._map || !this._lngLat || !this._content) { return; }

        if (!this._container) {
            this._container = DOM.create('div', 'mapboxgl-popup', this._map.getContainer());
            this._tip       = DOM.create('div', 'mapboxgl-popup-tip', this._container);
            this._container.appendChild(this._content);

            if (this.options.className) {
                this.options.className.split(' ').forEach(name =>
                    this._container.classList.add(name));
            }
        }

        if (this._map.transform.renderWorldCopies) {
            this._lngLat = smartWrap(this._lngLat, this._pos, this._map.transform);
        }

        const pos = this._pos = this._map.project(this._lngLat);

        let anchor: ?Anchor = this.options.anchor;
        const offset = normalizeOffset(this.options.offset);

        if (!anchor) {
            const width = this._container.offsetWidth;
            const height = this._container.offsetHeight;
            let anchorComponents;

            if (pos.y + offset.bottom.y < height) {
                anchorComponents = ['top'];
            } else if (pos.y > this._map.transform.height - height) {
                anchorComponents = ['bottom'];
            } else {
                anchorComponents = [];
            }

            if (pos.x < width / 2) {
                anchorComponents.push('left');
            } else if (pos.x > this._map.transform.width - width / 2) {
                anchorComponents.push('right');
            }

            if (anchorComponents.length === 0) {
                anchor = 'bottom';
            } else {
                anchor = (anchorComponents.join('-'): any);
            }
        }

        const offsetedPos = pos.add(offset[anchor]).round();

        DOM.setTransform(this._container, `${anchorTranslate[anchor]} translate(${offsetedPos.x}px,${offsetedPos.y}px)`);
        applyAnchorClass(this._container, anchor, 'popup');
    }

    _onClickClose() {
        this.remove();
    }
}

function normalizeOffset(offset: ?Offset) {
    if (!offset) {
        return normalizeOffset(new Point(0, 0));

    } else if (typeof offset === 'number') {
        // input specifies a radius from which to calculate offsets at all positions
        const cornerOffset = Math.round(Math.sqrt(0.5 * Math.pow(offset, 2)));
        return {
            'center': new Point(0, 0),
            'top': new Point(0, offset),
            'top-left': new Point(cornerOffset, cornerOffset),
            'top-right': new Point(-cornerOffset, cornerOffset),
            'bottom': new Point(0, -offset),
            'bottom-left': new Point(cornerOffset, -cornerOffset),
            'bottom-right': new Point(-cornerOffset, -cornerOffset),
            'left': new Point(offset, 0),
            'right': new Point(-offset, 0)
        };

    } else if (offset instanceof Point || Array.isArray(offset)) {
        // input specifies a single offset to be applied to all positions
        const convertedOffset = Point.convert(offset);
        return {
            'center': convertedOffset,
            'top': convertedOffset,
            'top-left': convertedOffset,
            'top-right': convertedOffset,
            'bottom': convertedOffset,
            'bottom-left': convertedOffset,
            'bottom-right': convertedOffset,
            'left': convertedOffset,
            'right': convertedOffset
        };

    } else {
        // input specifies an offset per position
        return {
            'center': Point.convert(offset['center'] || [0, 0]),
            'top': Point.convert(offset['top'] || [0, 0]),
            'top-left': Point.convert(offset['top-left'] || [0, 0]),
            'top-right': Point.convert(offset['top-right'] || [0, 0]),
            'bottom': Point.convert(offset['bottom'] || [0, 0]),
            'bottom-left': Point.convert(offset['bottom-left'] || [0, 0]),
            'bottom-right': Point.convert(offset['bottom-right'] || [0, 0]),
            'left': Point.convert(offset['left'] || [0, 0]),
            'right': Point.convert(offset['right'] || [0, 0])
        };
    }
}
