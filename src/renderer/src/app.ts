import { route } from '@aurelia/router'

@route({
    routes: [
        { path: '', redirectTo: 'welcome' },
        { path: 'welcome', component: () => import('./views/welcome'), title: 'Welcome' },
        { path: 'manage-cli', component: () => import('./views/manage-cli'), title: 'Manage Arduino CLI' },
        { path: 'select-device', component: () => import('./views/select-device'), title: 'Select Device' },
        { path: 'select-product', component: () => import('./views/select-product'), title: 'Select Product' },
        { path: 'select-version', component: () => import('./views/select-version'), title: 'Select Version' },
        { path: 'commandstation-config', component: () => import('./views/commandstation-config'), title: 'CommandStation Config' },
        { path: 'ioexpander-config', component: () => import('./views/ioexpander-config'), title: 'IOExpander Config' },
        { path: 'turntable-config', component: () => import('./views/turntable-config'), title: 'Turntable Config' },
        { path: 'advanced-config', component: () => import('./views/advanced-config'), title: 'Advanced Config' },
        { path: 'compile-upload', component: () => import('./views/compile-upload'), title: 'Compile & Upload' },
    ],
})
export class App {
}

