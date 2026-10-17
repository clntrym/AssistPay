// <app-icon name="CalendarDays" :size="18" />
// Renders a Lucide icon (https://lucide.dev/icons) as inline SVG so it updates with Vue.
const AppIcon = {
    props: {
        name: { type: String, required: true },
        size: { type: [Number, String], default: 18 },
        strokeWidth: { type: [Number, String], default: 2 }
    },
    setup(props) {
        return () => {
            const node = lucide.icons?.[props.name] ?? lucide[props.name];
            if (!node) {
                console.warn(`AppIcon: unknown Lucide icon "${props.name}"`);
                return null;
            }
            const [, attrs, children] = node;
            return Vue.h("svg", {
                ...attrs,
                width: props.size,
                height: props.size,
                "stroke-width": props.strokeWidth,
                "aria-hidden": "true",
                focusable: "false",
                class: "shrink-0"
            }, children.map(([tag, childAttrs]) => Vue.h(tag, childAttrs)));
        };
    }
};
