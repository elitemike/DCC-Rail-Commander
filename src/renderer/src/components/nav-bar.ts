import { bindable } from 'aurelia'

export class NavBar {
    @bindable showBack = true
    @bindable showNext = true
    @bindable showMonitor = false
    @bindable backText = 'Back'
    @bindable nextText = 'Next'
    @bindable backDisabled = false
    @bindable nextDisabled = false
    @bindable backAction: () => void = () => { }
    @bindable nextAction: () => void = () => { }
    @bindable monitorAction: () => void = () => { }
}
